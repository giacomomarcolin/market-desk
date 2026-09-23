export function preparedJobFiles(localFiles, dropboxFiles, connected) {
  if (!connected) return localFiles;

  const filesRequiringAttention = localFiles.filter((file) => file.dropboxStatus !== "synced");
  const currentDropboxFiles = dropboxFiles.map((file) => ({
    id: file.id,
    label: file.name,
    filename: file.name,
    contentType: "application/octet-stream",
    sizeBytes: file.sizeBytes || 0,
    uploadedAt: file.modifiedAt || "",
    dropboxPath: file.path,
    dropboxStatus: "synced",
    dropboxSyncedAt: file.modifiedAt,
    dropboxError: null,
    source: "dropbox",
    modifiedAt: file.modifiedAt,
  }));
  return [...filesRequiringAttention, ...currentDropboxFiles];
}
