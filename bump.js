#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const validBumps = new Set(["patch", "minor", "major"]);
const bumpType = process.argv[2];

if (!validBumps.has(bumpType)) {
  console.error("Uso: node bump.js <patch|minor|major>");
  process.exit(1);
}

const packagePath = path.resolve(process.cwd(), "package.json");

if (!fs.existsSync(packagePath)) {
  console.error("No se encontro package.json en el directorio actual.");
  process.exit(1);
}

const raw = fs.readFileSync(packagePath, "utf8");
const pkg = JSON.parse(raw);

if (typeof pkg.version !== "string") {
  console.error("El campo version en package.json no es valido.");
  process.exit(1);
}

const match = pkg.version.match(/^(\d+)\.(\d+)\.(\d+)$/);

if (!match) {
  console.error(`Version invalida: ${pkg.version}. Se espera formato x.y.z`);
  process.exit(1);
}

let major = Number(match[1]);
let minor = Number(match[2]);
let patch = Number(match[3]);

if (bumpType === "patch") {
  patch += 1;
} else if (bumpType === "minor") {
  minor += 1;
  patch = 0;
} else {
  major += 1;
  minor = 0;
  patch = 0;
}

const nextVersion = `${major}.${minor}.${patch}`;
const previousVersion = pkg.version;

pkg.version = nextVersion;

fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

console.log(`Version actualizada: ${previousVersion} -> ${nextVersion}`);
