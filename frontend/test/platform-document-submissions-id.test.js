import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { UUID } from "../server/platform-document-submissions.js";

test("proposition au catalogue : un identifiant réel de pièce jointe est accepté", () => {
  for (let index = 0; index < 50; index++) assert.equal(UUID.test(randomUUID()), true);
  assert.equal(UUID.test("33333333-3333-4333-8333-333333333333"), true);
});

test("proposition au catalogue : identifiants malformés toujours refusés", () => {
  for (const bad of ["", "../x", "33333333-3333-4333-8333-33333333333", "33333333-3333-4333-8333333333333333",
    "33333333-3333-4333-c333-333333333333", "33333333-3333-4333-8333-333333333333/../x", "zzzzzzzz-3333-4333-8333-333333333333"]) {
    assert.equal(UUID.test(bad), false, bad);
  }
});
