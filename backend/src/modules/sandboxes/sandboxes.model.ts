import { t } from "elysia";

/** What to start inside a sandbox when hacked mud starts */
export const AutoStartT = t.Union([t.Literal("off"), t.Literal("steam"), t.Literal("hackmud")]);
export type AutoStart = typeof AutoStartT.static;

export const SandboxT = t.Object({
  name: t.String(),
  /** processes running inside the sandbox */
  pids: t.Array(t.Number()),
  steamRunning: t.Boolean(),
  /** hackmud_win.exe processes inside the sandbox */
  hackmudPids: t.Array(t.Number()),
  autoStart: AutoStartT,
});
export type Sandbox = typeof SandboxT.static;

export const SandboxListResponseT = t.Object({
  /** false on linux, sandboxes are a windows only feature */
  supported: t.Boolean(),
  sandboxieInstalled: t.Boolean(),
  boxes: t.Array(SandboxT),
});
export type SandboxListResponse = typeof SandboxListResponseT.static;

export const SandboxNameRequestT = t.Object({
  name: t.String(),
});

export const LaunchRequestT = t.Object({
  name: t.String(),
  /** "steam" opens Steam, "hackmud" opens Steam and launches hackmud */
  target: t.Union([t.Literal("steam"), t.Literal("hackmud")]),
});

export const DeleteRequestT = t.Object({
  name: t.String(),
  /** also delete the sandbox's files: its Steam login and the sandboxed hackmud scripts */
  deleteContents: t.Boolean(),
});

export const SetAutoStartRequestT = t.Object({
  name: t.String(),
  autoStart: AutoStartT,
});

export type SandboxError = {
  type: "SANDBOX_ERROR";
  message: string;
};
