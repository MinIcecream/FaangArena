// wipe-and-seed.mjs
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  BatchWriteCommand,
  PutCommand
} from "@aws-sdk/lib-dynamodb";
import { readFile } from "fs/promises";
import { argv, exit } from "process";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE  = process.env.TABLE_NAME || "Arena-faangarena-v2";  // set via env for safety

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

function parseArgs() {
  const args = new Map();
  for (const a of argv.slice(2)) {
    const [k,v] = a.split("=");
    args.set(k.replace(/^--/,""), v ?? true);
  }
  return args;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i+size));
  return out;
}

async function wipeAll() {
  console.log(`🧹 Scanning table ${TABLE} for all keys...`);
  let toDelete = [];
  let lastKey;
  let scanned = 0;

  do {
    const res = await ddb.send(new ScanCommand({
      TableName: TABLE,
      ProjectionExpression: "pk, sk",
      ExclusiveStartKey: lastKey
    }));
    const batch = (res.Items || []).map(({ pk, sk }) => ({ DeleteRequest: { Key: { pk, sk } } }));
    toDelete.push(...batch);
    scanned += res.ScannedCount || 0;
    lastKey = res.LastEvaluatedKey;
    console.log(`  • scanned: ${scanned}, queued for delete: ${toDelete.length}`);
  } while (lastKey);

  if (toDelete.length === 0) {
    console.log("✅ Table already empty.");
    return;
  }

  console.log(`🗑️ Deleting ${toDelete.length} items in batches of 25...`);
  for (const batch of chunk(toDelete, 25)) {
    await ddb.send(new BatchWriteCommand({ RequestItems: { [TABLE]: batch } }));
  }
  console.log("✅ Wipe complete.");
}

async function seed(filePath) {
  console.log(`🌱 Seeding from ${filePath} into ${TABLE} ...`);
  const companies = JSON.parse(await readFile(filePath, "utf8"));
  const now = Date.now();

  for (const c of companies) {
    const id = c.name;
    const item = {
      pk: `COMPANY#${id}`,
      sk: 0, // numeric sort key for company "meta" row
      id,
      name: c.name,
      logo: c.logo,
      score: 500,
      created_at: now,
      gsi1pk: "LEADERBOARD",
      gsi1sk: 500,
      gsi2pk: "COMPANY",
      gsi2sk: id
    };

    try {
      await ddb.send(new PutCommand({
        TableName: TABLE,
        Item: item,
        // If you want to overwrite instead of skip, remove the ConditionExpression
        ConditionExpression: "attribute_not_exists(pk)"
      }));
      console.log(`  ✅ Inserted: ${id}`);
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        console.log(`  ⚠️  Skipped (exists): ${id}`);
      } else {
        console.error(`  ❌ ${id}:`, err.message);
      }
    }
  }
  console.log("🎯 Seeding complete.");
}

(async () => {
  const args = parseArgs();
  const file = args.get("file") || "./companies-data.json";
  const wipe = args.has("wipe") || args.get("wipe-all");

  if (!file) {
    console.error("Missing companies JSON. Pass --file=./companies-data.json");
    exit(1);
  }

  if (wipe) await wipeAll();
  await seed(file);
})();
