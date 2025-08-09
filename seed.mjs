// seed.mjs — inserts companies with sk: 0
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { readFile } from "fs/promises";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE  = process.env.TABLE_NAME || "Arena-faangarena-v2"; // or read from stack output

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

// load companies-data.json from same folder
const companies = JSON.parse(
  await readFile(new URL("./companies-data.json", import.meta.url), "utf8")
);

async function seed() {
  const now = Date.now();
  for (const c of companies) {
    const id = c.name;
    const item = {
      pk: `COMPANY#${id}`,
      sk: 0,
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
        ConditionExpression: "attribute_not_exists(pk)"
      }));
      console.log(`✅ Inserted: ${id}`);
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        console.log(`⚠️  Skipped (exists): ${id}`);
      } else {
        console.error(`❌ Error inserting ${id}:`, err.message);
      }
    }
  }
  console.log("🎯 Seeding complete.");
}

seed();
