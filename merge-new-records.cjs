const fs = require("fs");
const path = require("path");

const root = __dirname;

const datasets = [
  {
    name: "SALES",
    existing: "app/src/data/raw_buyer_sales.json",
    exported: "data/buyer_sales_all.json",
    backup: "backup_before_merge/raw_buyer_sales.json",
  },
  {
    name: "PAYMENTS",
    existing: "app/src/data/raw_buyer_payments.json",
    exported: "data/buyer_payments_all.json",
    backup: "backup_before_merge/raw_buyer_payments.json",
  },
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

for (const dataset of datasets) {
  const existing = readJson(dataset.existing);
  const exported = readJson(dataset.exported);
  const backup = readJson(dataset.backup);

  if (!Array.isArray(existing) || !Array.isArray(exported)) {
    throw new Error(`${dataset.name}: expected JSON arrays.`);
  }

  if (JSON.stringify(existing) !== JSON.stringify(backup)) {
    throw new Error(
      `${dataset.name}: current file differs from backup. Stopping safely.`
    );
  }

  const existingIds = new Set(existing.map((r) => String(r.id)));
  const added = exported.filter((r) => !existingIds.has(String(r.id)));

  const merged = [...existing, ...added];

  console.log(
    `${dataset.name}: ${existing.length} existing + ${added.length} new = ${merged.length} total`
  );

  // Save the proposed result separately; do not overwrite frontend files.
  const output = path.join(
    root,
    "backup_before_merge",
    dataset.name.toLowerCase() + "_merged_preview.json"
  );

  fs.writeFileSync(output, JSON.stringify(merged, null, 2) + "\n", "utf8");
  console.log(`Preview saved: ${output}`);
}