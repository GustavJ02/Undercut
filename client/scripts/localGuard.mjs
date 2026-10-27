// Real-identity mods never get committed (docs/presentation-design.md section 6): these paths are for the owner's own machine.
export const BLOCKED = [/^mods\/local(\/|$)/, /^mods\/[^/]+\.zip$/, /^client\/public\/mods-user(\/|$)/];

/** The staged paths that must not be committed. */
export const blockedPaths = (paths) => paths.map((p) => p.replace(/\\/g, "/").replace(/^\.\//, "")).filter((p) => BLOCKED.some((re) => re.test(p)));
