const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const suites = fs
  .readdirSync(__dirname)
  .filter((name) => name.endsWith(".test.js"))
  .sort();

let totalPassed = 0;
let totalFailed = 0;
const broken = [];

suites.forEach((suite) => {
  const label = suite.replace(/\.test\.js$/, "").padEnd(22);
  let output = "";
  let crashed = false;

  try {
    output = execFileSync(process.execPath, [path.join(__dirname, suite)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    crashed = true;
    output = `${error.stdout || ""}${error.stderr || ""}`;
  }

  const summary = output.trim().split("\n").pop() || "";
  const counts = summary.match(/^(\d+) passed, (\d+) failed$/);

  if (counts) {
    totalPassed += Number(counts[1]);
    totalFailed += Number(counts[2]);
  }

  if (crashed || !counts || Number(counts[2]) > 0) {
    broken.push(suite);
    process.stdout.write(`FAIL ${label} ${summary}\n`);
    const detail = output.trim().split("\n").slice(0, -1).join("\n");
    if (detail) {
      process.stdout.write(`${detail}\n`);
    }
    return;
  }

  process.stdout.write(`ok   ${label} ${summary}\n`);
});

process.stdout.write(
  `\n${suites.length} suites, ${totalPassed} passed, ${totalFailed} failed\n`,
);

if (broken.length > 0) {
  process.stdout.write(`failing suites: ${broken.join(", ")}\n`);
  process.exit(1);
}
