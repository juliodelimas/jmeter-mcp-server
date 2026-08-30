import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSpawnInvocation } from "../src/execution/processManager.js";

test("buildSpawnInvocation leaves non-Windows spawns untouched", () => {
  const result = buildSpawnInvocation("/opt/jmeter/bin/jmeter", ["-n", "-t", "/tmp/plan.jmx"], "linux");
  assert.equal(result.shell, false);
  assert.equal(result.command, "/opt/jmeter/bin/jmeter");
  assert.deepEqual(result.args, ["-n", "-t", "/tmp/plan.jmx"]);
});

test("buildSpawnInvocation leaves a non-batch Windows binary untouched", () => {
  const result = buildSpawnInvocation("C:\\jmeter\\bin\\jmeter.exe", ["-n"], "win32");
  assert.equal(result.shell, false);
  assert.equal(result.command, "C:\\jmeter\\bin\\jmeter.exe");
});

test("buildSpawnInvocation routes .bat files through the shell on Windows", () => {
  const result = buildSpawnInvocation("C:\\jmeter\\bin\\jmeter.bat", ["-n", "-t", "plan.jmx"], "win32");
  assert.equal(result.shell, true);
  assert.equal(result.command, "C:\\jmeter\\bin\\jmeter.bat");
});

test("buildSpawnInvocation quotes Windows paths containing spaces", () => {
  const result = buildSpawnInvocation(
    "C:\\Program Files\\jmeter\\bin\\jmeter.bat",
    ["-n", "-t", "C:\\Users\\Jane Doe\\plan.jmx"],
    "win32",
  );
  assert.equal(result.command, '"C:\\Program Files\\jmeter\\bin\\jmeter.bat"');
  assert.deepEqual(result.args, ["-n", "-t", '"C:\\Users\\Jane Doe\\plan.jmx"']);
});

test("buildSpawnInvocation is case-insensitive for .cmd files", () => {
  const result = buildSpawnInvocation("C:\\jmeter\\bin\\jmeter.CMD", [], "win32");
  assert.equal(result.shell, true);
});
