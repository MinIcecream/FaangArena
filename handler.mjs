// handler.mjs
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  BatchGetCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE = process.env.TABLE_NAME || "Arena-faangarena-v2";

// Rate limit
const RATE_LIMIT_MAX = 300;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export const handler = async (event) => {
  try {
    const method = event.requestContext?.http?.method || event.httpMethod;
    const path = event.requestContext?.http?.path || event.path || "";
    const body = event.body ? JSON.parse(event.body) : {};

    // -------- GET /api/companies --------
    if (method === "GET" && path.endsWith("/api/companies")) {
      const res = await ddb.send(
        new QueryCommand({
          TableName: TABLE,
          IndexName: "GSI1",
          KeyConditionExpression: "gsi1pk = :lb",
          ExpressionAttributeValues: { ":lb": "LEADERBOARD" },
          ScanIndexForward: false, // descending by score
          Limit: 200,
        })
      );
      return json(200, res.Items ?? []);
    }

    // -------- GET /api/battle --------
    if (method === "GET" && path.endsWith("/api/battle")) {
      const res = await ddb.send(
        new QueryCommand({
          TableName: TABLE,
          IndexName: "GSI2",
          KeyConditionExpression: "gsi2pk = :t",
          ExpressionAttributeValues: { ":t": "COMPANY" },
          ProjectionExpression: "id, #n, logo, score",
          ExpressionAttributeNames: { "#n": "name" },
        })
      );
      const companies = res.Items || [];
      if (companies.length < 2) return json(400, { error: "Not enough companies" });
      const [a, b] = pickTwo(companies);
      return json(200, [a, b]);
    }

    // -------- POST /api/vote --------
     if (method === "POST" && path.endsWith("/api/vote")) {

      try {
        const { winnerId, loserId } = body;
        if (!winnerId || !loserId) return json(400, { error: "Missing winnerId or loserId" });

        const { key: rlKey } = getDeviceOrIp(event);
        const userAgent = event.headers?.["user-agent"] || event.headers?.["User-Agent"] || "";
        const now = Date.now();

        // 1️⃣ Rate limiting
        const since = now - RATE_LIMIT_WINDOW_MS;
        const rateQuery = await ddb.send(
          new QueryCommand({
            TableName: TABLE,
            KeyConditionExpression: "#pk = :pk AND #sk >= :since",
            ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
            ExpressionAttributeValues: { ":pk": rlKey, ":since": since },
            Select: "COUNT",
          })
        );
        if ((rateQuery.Count || 0) >= RATE_LIMIT_MAX) {
          return json(429, { error: "Too many votes" });
        }

        // 2️⃣ Load current scores
        
        const batchResponse = await ddb.send(
          new BatchGetCommand({
            RequestItems: {
              [TABLE]: {
                Keys: [
                  { pk: `COMPANY#${winnerId}`, sk: 0 },
                  { pk: `COMPANY#${loserId}`, sk: 0 },
                ],
                ProjectionExpression: "pk, sk, id, #n, logo, score",
                ExpressionAttributeNames: { "#n": "name" },
              },
            },
          })
        );


        const items = batchResponse.Responses?.[TABLE] || [];

        const companyMap = new Map(items.map((i) => [`${i.pk}|${i.sk}`, i]));
        const winner = companyMap.get(`COMPANY#${winnerId}|0`);
        const loser = companyMap.get(`COMPANY#${loserId}|0`);

        if (!winner || !loser) {
          console.error("Invalid IDs:", { winnerId, loserId, items });
          return json(400, { 
            error: "Invalid IDs", 
          });

        }


        // 3️⃣ Calculate Elo
        const winnerScore = winner.score ?? 500;
        const loserScore = loser.score ?? 500;
        const expectedWinner = 1 / (1 + Math.pow(10, (loserScore - winnerScore) / 400));
        const kFactor = 12;
        const scoreDelta = Math.round(kFactor * (1 - expectedWinner));
        const newWinnerScore = Math.max(winnerScore + scoreDelta, 100);
        const newLoserScore = Math.max(loserScore - Math.floor(scoreDelta * 0.5), 100);
        const ttl = Math.floor((now + 90 * 24 * 3600 * 1000) / 1000);

        // 4️⃣ Write transaction
        await ddb.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: TABLE,
                  Item: {
                    pk: rlKey,
                    sk: now,
                    entity: "VOTE",
                    winner_id: winnerId,
                    loser_id: loserId,
                    user_agent: userAgent,
                    created_at: now,
                    ttl,
                  },
                },
              },
              {
                Update: {
                  TableName: TABLE,
                  Key: { pk: `COMPANY#${winnerId}`, sk: 0 },
                  UpdateExpression: "SET #s = :newScore, gsi1pk = :lb, gsi1sk = :newScore",
                  ExpressionAttributeNames: { "#s": "score" },
                  ExpressionAttributeValues: { ":newScore": newWinnerScore, ":lb": "LEADERBOARD" },
                },
              },
              {
                Update: {
                  TableName: TABLE,
                  Key: { pk: `COMPANY#${loserId}`, sk: 0 },
                  UpdateExpression: "SET #s = :newScore, gsi1pk = :lb, gsi1sk = :newScore",
                  ExpressionAttributeNames: { "#s": "score" },
                  ExpressionAttributeValues: { ":newScore": newLoserScore, ":lb": "LEADERBOARD" },
                },
              },
            ],
          })
        );

        const nextOpponent = await pickRandomOpponentExcluding([winnerId, loserId]);
        return json(200, { success: true, scoreChange: scoreDelta, winnerScore: newWinnerScore, loserScore: newLoserScore, nextOpponent });
      }
      catch (err) {
        console.error("❌ Error in /api/vote", err);
        return json(500, { error: "Could not process vote", details: err.message });
      }
  }
      
    // -------- GET /api/stats --------
    if (method === "GET" && path.endsWith("/api/stats")) {
      const votes = await ddb.send(
        new ScanCommand({ TableName: TABLE, Select: "COUNT", FilterExpression: "attribute_not_exists(gsi1pk)" })
      );
      const comps = await ddb.send(
        new QueryCommand({
          TableName: TABLE,
          IndexName: "GSI2",
          KeyConditionExpression: "gsi2pk = :t",
          ExpressionAttributeValues: { ":t": "COMPANY" },
          Select: "COUNT",
        })
      );
      return json(200, { totalVotes: votes.Count || 0, totalCompanies: comps.Count || 0 });
    }

    // -------- Root --------
    if (method === "GET" && (path === "/" || path === "")) {
      return html(200, "<h1>FAANGArena API</h1><p>Call /api/* endpoints from your site.</p>");
    }

    return json(404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    return json(500, { error: "Something went wrong!", details: err.message });
  }
};

// ------- helpers -------
function pickTwo(arr) {
  const i = Math.floor(Math.random() * arr.length);
  let j = Math.floor(Math.random() * (arr.length - 1));
  if (j >= i) j++;
  return [arr[i], arr[j]];
}

async function pickRandomOpponentExcluding(excludeIds = []) {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: "GSI2",
      KeyConditionExpression: "gsi2pk = :t",
      ExpressionAttributeValues: { ":t": "COMPANY" },
      ProjectionExpression: "id, #n, logo, score",
      ExpressionAttributeNames: { "#n": "name" },
    })
  );
  const items = (res.Items || []).filter((c) => !excludeIds.includes(c.id));
  if (items.length === 0) return null;
  const idx = Math.floor(Math.random() * items.length);
  return items[idx];
}

function getDeviceOrIp(event) {
  const h = event.headers || {};
  const did = h["x-device-id"] || h["X-Device-Id"];
  if (did && typeof did === "string" && did.length <= 128) return { key: `DEVICE#${did}`, id: did };
  const ip =
    h["x-forwarded-for"]?.split(",")[0]?.trim() ||
    h["x-real-ip"] ||
    event.requestContext?.http?.sourceIp ||
    "0.0.0.0";
  return { key: `IP#${ip}`, id: ip };
}

function json(statusCode, data) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(data) };
}
function html(statusCode, markup) {
  return { statusCode, headers: { "content-type": "text/html" }, body: markup };
}
