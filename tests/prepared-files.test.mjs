import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { preparedJobFiles } from "../db/prepared-files.js";

const oldFolder = "/JobMkt2026/applications/old_generated_folder";
const currentFolder = "/JobMkt2026/applications/mit_sloan_ties";
const localFile = (id, status, path = null) => ({ id, label: id, filename: `${id}.pdf`, dropboxPath: path, dropboxStatus: status, source: "market_desk" });
const dropboxFile = (id, path) => ({ id, name: `${id}.pdf`, path, modifiedAt: "2026-09-23T00:00:00.000Z", sizeBytes: 42 });

test("connected Dropbox shows only files in the current folder and local files needing attention", () => {
  const localFiles = [
    localFile("old-synced", "synced", `${oldFolder}/old-synced.pdf`),
    localFile("current-synced", "synced", `${currentFolder}/current-synced.pdf`),
    localFile("unsynced", "not_synced"),
    localFile("failed", "failed", `${oldFolder}/failed.pdf`),
    localFile("syncing", "syncing", `${currentFolder}/syncing.pdf`),
  ];
  const currentFiles = [dropboxFile("dropbox:current-synced", `${currentFolder}/current-synced.pdf`), dropboxFile("dropbox:direct", `${currentFolder}/direct.pdf`)];
  const result = preparedJobFiles(localFiles, currentFiles, true);

  assert.deepEqual(result.map((file) => file.id), ["unsynced", "failed", "syncing", "dropbox:current-synced", "dropbox:direct"]);
  assert.ok(result.filter((file) => file.dropboxPath === `${currentFolder}/current-synced.pdf`).length === 1);
  assert.ok(result.filter((file) => file.source === "dropbox").every((file) => file.dropboxPath.startsWith(`${currentFolder}/`)));
});

test("a synced file deleted from Dropbox disappears on refresh", () => {
  const localFiles = [localFile("synced", "synced", `${currentFolder}/synced.pdf`)];
  const listingBeforeDeletion = [dropboxFile("dropbox:synced", `${currentFolder}/synced.pdf`)];
  assert.deepEqual(preparedJobFiles(localFiles, listingBeforeDeletion, true).map((file) => file.id), ["dropbox:synced"]);
  assert.deepEqual(preparedJobFiles(localFiles, [], true), []);
});

test("disconnected Dropbox still shows all local files", () => {
  const localFiles = [localFile("old-synced", "synced", `${oldFolder}/old-synced.pdf`), localFile("failed", "failed")];
  assert.deepEqual(preparedJobFiles(localFiles, [], false), localFiles);
});

test("Prepared files filtering does not delete or mutate stored files", async () => {
  const localFiles = [localFile("old-synced", "synced", `${oldFolder}/old-synced.pdf`)];
  const currentFiles = [dropboxFile("dropbox:current", `${currentFolder}/current.pdf`)];
  preparedJobFiles(localFiles, currentFiles, true);
  assert.equal(localFiles.length, 1);
  assert.equal(localFiles[0].dropboxPath, `${oldFolder}/old-synced.pdf`);
  assert.equal(currentFiles.length, 1);
  const helper = await readFile(new URL("../db/prepared-files.js", import.meta.url), "utf8");
  assert.doesNotMatch(helper, /\.delete\(|DELETE FROM|files\/delete|\.move\(/);
});
