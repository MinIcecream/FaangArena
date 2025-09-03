import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE  = process.env.TABLE_NAME || "Arena-faangarena-v2";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

async function deleteOneRBC() {
  // Query all items with pk = COMPANY#RBC
  const { Items } = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "pk = :pk",
    ExpressionAttributeValues: { ":pk": "COMPANY#RBC" },
    ProjectionExpression: "pk, sk"
  }));

  if (!Items || Items.length === 0) {
    console.log("No RBC entries found.");
    return;
  }

  // Pick the first one arbitrarily
  const itemToDelete = Items[0];

  try {
    await ddb.send(new DeleteCommand({
      TableName: TABLE,
      Key: { pk: itemToDelete.pk, sk: itemToDelete.sk }
    }));
    console.log(`✅ Deleted one RBC: sk = ${itemToDelete.sk}`);
  } catch (err) {
    console.error("❌ Error deleting RBC:", err.message);
  }
}

deleteOneRBC();
