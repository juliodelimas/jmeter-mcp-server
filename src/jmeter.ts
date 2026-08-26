import { existsSync } from "node:fs";
import path from "node:path";

export function resolveJmeterBin(): string {
  const jmeterHome = process.env.JMETER_HOME;
  if (!jmeterHome) {
    throw new Error(
      "JMETER_HOME is not set. Point it at your JMeter installation directory " +
        "(the one containing bin/jmeter) and restart the server.",
    );
  }
  const binName = process.platform === "win32" ? "jmeter.bat" : "jmeter";
  const binPath = path.join(jmeterHome, "bin", binName);
  if (!existsSync(binPath)) {
    throw new Error(
      `Could not find JMeter binary at ${binPath}. Check that JMETER_HOME ` +
        `(currently "${jmeterHome}") points at a valid JMeter installation.`,
    );
  }
  return binPath;
}
