// Fixture: a minimal, dependency-free TypeSpec model for the "Ping"
// walking-skeleton subject (see ../model.em). Deliberately uses only
// @typespec/compiler core syntax -- no @typespec/http or other libraries --
// so `npx tsp compile main.tsp --no-emit` succeeds with just the compiler
// installed, in any environment that has one. See findings/wave2-bridge.md
// for why positive-path "it compiles" assertions are additionally gated on a
// hasTsp() test helper rather than assumed to always run.

namespace PingFixture;

model Ping {
  postedAt: utcDateTime;
  source: string;
}

model Notification {
  pingId: string;
  channel: string;
}
