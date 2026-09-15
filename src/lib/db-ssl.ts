import { readFileSync } from "node:fs";

/**
 * RDS (and most managed Postgres) requires SSL, and its server cert chains to
 * Amazon's own RDS CA -- not one already in Node's default trust store -- so
 * verification fails with "self-signed certificate in certificate chain"
 * unless that CA bundle is supplied explicitly. Local dev Postgres usually
 * has no SSL configured at all, so it's skipped for local hosts.
 *
 * The deploy environment downloads AWS's published bundle to RDS_CA_BUNDLE_PATH
 * (https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem) before
 * the app starts. Everything still gets verified normally against it --
 * nothing here relaxes certificate checking.
 */
export function dbSslConfig(databaseUrl: string | undefined): boolean | { ca: string } {
  if (/localhost|127\.0\.0\.1/.test(databaseUrl ?? "")) return false;
  const caPath = process.env.RDS_CA_BUNDLE_PATH;
  if (!caPath) return true;
  return { ca: readFileSync(caPath, "utf8") };
}
