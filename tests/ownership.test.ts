import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const owner = "Carlao Antonio de Oliveira Piquet";
const email = "carlos.piquet2016@gmail.com";

test("pacote preserva autoria e licença proprietária", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.author.name, owner);
  assert.equal(packageJson.author.email, email);
  assert.equal(packageJson.license, "UNLICENSED");
});

test("distribuição Docker carrega licença e identificação do titular", () => {
  const license = readFileSync("LICENSE", "utf8");
  const dockerfile = readFileSync("Dockerfile", "utf8");
  assert.match(license, new RegExp(owner));
  assert.match(license, new RegExp(email.replace(".", "\\.")));
  assert.match(dockerfile, /org\.opencontainers\.image\.authors/);
  assert.match(dockerfile, /LicenseRef-Finora-Proprietary-1\.0/);
});
