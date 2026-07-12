import assert from "node:assert/strict";
import test from "node:test";
import { shareTokenHash } from "../lib/share-access";

test("token compartilhado é persistido somente como hash", () => {
  const token = "segredo-na-url";
  const hashed = shareTokenHash(token);
  assert.notEqual(hashed, token);
  assert.equal(hashed.length, 64);
  assert.equal(hashed, shareTokenHash(token));
  assert.notEqual(hashed, shareTokenHash("outro-token"));
});
