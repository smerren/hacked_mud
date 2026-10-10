<template>
  <div>
    <div class="q-mb-sm">
      Steam sandboxes
      <span class="text-grey-7">(extra Steam accounts, each in its own Sandboxie box)</span>
    </div>

    <div v-if="!state" class="text-grey-7">Loading...</div>
    <div v-else-if="!state.supported" class="text-grey-7">
      Sandboxes are only available on Windows.
    </div>
    <div v-else-if="!state.sandboxieInstalled" class="text-grey-7">
      Sandboxie-Plus is not installed. Re-run the hacked mud installer and tick "Set up a second
      Steam account".
    </div>
    <template v-else>
      <div v-if="state.boxes.length == 0" class="text-grey-7 q-mb-sm">No sandboxes yet.</div>

      <div v-for="box in state.boxes" :key="box.name" class="sandbox q-pa-sm q-mb-sm">
        <div class="row items-center q-gutter-sm">
          <div class="text-weight-bold">{{ box.name }}</div>
          <q-badge v-if="box.steamRunning" color="positive" label="Steam running" />
          <q-badge v-else-if="box.pids.length > 0" color="grey-7" label="starting" />
          <q-badge v-else color="grey-8" label="stopped" />
          <q-badge
            v-for="pid in box.hackmudPids"
            :key="'hm' + pid"
            color="primary"
            :label="'hackmud ' + pid"
          />
        </div>

        <div class="row items-center q-gutter-sm q-mt-xs">
          <q-btn
            dense
            no-caps
            color="primary"
            icon="play_arrow"
            label="Steam"
            :loading="busy == box.name + 'steam'"
            @click="launch(box.name, 'steam')"
          />
          <q-btn
            dense
            no-caps
            color="primary"
            icon="terminal"
            label="hackmud"
            :disable="box.hackmudPids.length > 0"
            :loading="busy == box.name + 'hackmud'"
            @click="launch(box.name, 'hackmud')"
          />
          <q-btn
            dense
            no-caps
            flat
            color="warning"
            icon="stop"
            label="Stop"
            :disable="box.pids.length == 0"
            :loading="busy == box.name + 'stop'"
            @click="stop(box.name)"
          />
          <q-select
            dense
            options-dense
            emit-value
            map-options
            style="min-width: 170px"
            label="When hacked mud starts"
            :options="autoStartOptions"
            :model-value="box.autoStart"
            @update:model-value="(v: AutoStart) => setAutoStart(box.name, v)"
          />
          <q-space />
          <q-btn
            dense
            no-caps
            flat
            color="negative"
            icon="delete"
            label="Remove"
            @click="askRemove(box.name)"
          />
        </div>

        <div v-if="removing == box.name" class="q-mt-sm q-pa-sm confirm">
          <div>
            Remove {{ box.name }}? Anything running in it (Steam, hackmud) will be closed.
          </div>
          <q-checkbox
            v-model="deleteContents"
            dense
            label="Also delete its files (its Steam login and sandboxed hackmud scripts)"
          />
          <div class="q-gutter-sm q-mt-xs">
            <q-btn
              dense
              no-caps
              color="negative"
              label="Remove"
              :loading="busy == box.name + 'remove'"
              @click="remove(box.name)"
            />
            <q-btn dense no-caps flat label="Cancel" @click="removing = undefined" />
          </div>
        </div>
      </div>

      <q-btn
        dense
        no-caps
        color="secondary"
        icon="add"
        label="Add sandbox"
        :loading="busy == 'create'"
        @click="create"
      />
    </template>

    <div v-if="error" class="text-negative q-mt-sm">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { backend } from "src/utils/eden";
import type {
  AutoStart,
  SandboxListResponse,
} from "@backend/modules/sandboxes/sandboxes.model";

const state = ref<SandboxListResponse | undefined>(undefined);
const error = ref("");
const busy = ref<string | undefined>(undefined);
const removing = ref<string | undefined>(undefined);
const deleteContents = ref(false);

const autoStartOptions: { label: string; value: AutoStart }[] = [
  { label: "Do nothing", value: "off" },
  { label: "Start Steam", value: "steam" },
  { label: "Start hackmud", value: "hackmud" },
];

function errorMessage(e: unknown) {
  const value = (e as { value?: { message?: string } } | null)?.value;
  return value?.message ?? "Request failed";
}

async function refresh() {
  const res = await backend.sandboxes.get();
  if (res.error) {
    error.value = errorMessage(res.error);
    return;
  }
  state.value = res.data;
}

/** Runs an action, shows its error if any, then reloads the list */
async function act(key: string, action: () => Promise<{ error: unknown }>) {
  busy.value = key;
  error.value = "";
  try {
    const res = await action();
    if (res.error) error.value = errorMessage(res.error);
  } finally {
    busy.value = undefined;
    await refresh();
  }
}

const create = () => act("create", () => backend.sandboxes.create.post());
const launch = (name: string, target: "steam" | "hackmud") =>
  act(name + target, () => backend.sandboxes.launch.post({ name, target }));
const stop = (name: string) => act(name + "stop", () => backend.sandboxes.stop.post({ name }));
const setAutoStart = (name: string, autoStart: AutoStart) =>
  act(name + "autoStart", () => backend.sandboxes.autoStart.post({ name, autoStart }));

function askRemove(name: string) {
  removing.value = name;
  deleteContents.value = false;
}

async function remove(name: string) {
  await act(name + "remove", () =>
    backend.sandboxes.delete.post({ name, deleteContents: deleteContents.value })
  );
  removing.value = undefined;
}

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void refresh();
  timer = setInterval(() => void refresh(), 3000);
});
onUnmounted(() => clearInterval(timer));
</script>

<style scoped>
.sandbox {
  border: 1px solid rgba(255, 255, 255, 0.15);
}
.confirm {
  border: 1px solid var(--q-negative);
}
</style>
