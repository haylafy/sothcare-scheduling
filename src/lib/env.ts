/** Small typed accessor so a missing variable fails loudly at the call site. */
export function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === "" ? undefined : value;
}

export const APP_URL = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
export const BASE_PATH = () => process.env.SCHEDULING_BASE_PATH || "";

/** Absolute public URL for a path inside the module. */
export function publicUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${APP_URL()}${BASE_PATH()}${p}`;
}
