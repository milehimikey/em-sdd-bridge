// A stand-in for @typespec/compiler's `tsp` binary, driven by a
// `--mode=<mode>` argument placed BEFORE the compile args (so a tspCommand of
// ["node", "<this file>", "--mode=missing-lib"] exercises each failure class
// deterministically, with no real compiler installed). Modes:
//   ok           exit 0 (default)
//   missing-lib  TypeSpec's real import-not-found diagnostic, exit 1
//   compile-error  a real-shaped TypeSpec diagnostic, exit 1
//   not-found    exit 127 like a shell that cannot find the executable
//   record       also append argv + cwd to $FAKE_TSP_LOG (for assertions)
const mode = (process.argv.find((a) => a.startsWith("--mode=")) ?? "--mode=ok").slice("--mode=".length);
if (process.env.FAKE_TSP_LOG) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.FAKE_TSP_LOG, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + "\n");
}
switch (mode) {
  case "missing-lib":
    console.error('/repo/typespec/main.tsp:1:1 - error import-not-found: Couldn\'t resolve import "@typespec/http"');
    console.error("\nFound 1 error.");
    process.exit(1);
  case "compile-error":
    console.error("/repo/typespec/main.tsp:4:3 - error unknown-identifier: Unknown identifier utcDateTimee");
    console.error("\nFound 1 error.");
    process.exit(1);
  case "not-found":
    console.error("tsp: command not found");
    process.exit(127);
  default:
    if (process.argv.includes("--version")) console.log("TypeSpec compiler v0.0.0-fake");
    process.exit(0);
}
