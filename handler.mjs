// handler.mjs
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, QueryCommand, ScanCommand,
  BatchGetCommand, TransactWriteCommand
} from "@aws-sdk/lib-dynamodb";
import crypto from "crypto";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME || "Arena-faangarena-v2"; // overwritten by SAM env
const RATE_LIMIT_MAX = 50;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export const handler = async (event) => {
  try {
    const method = event.requestContext?.http?.method || event.httpMethod;
    const path = event.requestContext?.http?.path || event.path || "";
    const query = event.queryStringParameters || {};
    const body = event.body ? JSON.parse(event.body) : {};

    // CORS preflight (Function URL CORS already set; this doesn't hurt)
    if (method === "OPTIONS") return cors();

    // GET /api/companies  (leaderboard via GSI1)
    if (method === "GET" && path.endsWith("/api/companies")) {
      const res = await ddb.send(new QueryCommand({
        TableName: TABLE,
        IndexName: "GSI1", // leaderboard
        KeyConditionExpression: "gsi1pk = :lb",
        ExpressionAttributeValues: { ":lb": "LEADERBOARD" },
        ScanIndexForward: false, // DESC by score
        Limit: 200
      }));
      return json(200, res.Items ?? []);
    }

    // GET /api/battle  (get 2 random companies via GSI2 list)
    if (method === "GET" && path.endsWith("/api/battle")) {
      const all = await ddb.send(new QueryCommand({
        TableName: TABLE,
        IndexName: "GSI2", // list companies
        KeyConditionExpression: "gsi2pk = :t",
        ExpressionAttributeValues: { ":t": "COMPANY" },
        ProjectionExpression: "id, #n, logo, score",
        ExpressionAttributeNames: { "#n": "name" }
      }));
      const companies = all.Items || [];
      if (companies.length < 2) return json(400, { error: "Not enough companies" });
      const [a, b] = pickTwo(companies);
      return json(200, [a, b]);
    }

    // POST /api/vote  { winnerId, loserId }
    if (method === "POST" && path.endsWith("/api/vote")) {
      const { winnerId, loserId } = body || {};
      if (!winnerId || !loserId) return json(400, { error: "Missing winnerId or loserId" });

      const ip = clientIp(event);
      const userAgent = event.headers?.["user-agent"] || event.headers?.["User-Agent"] || "";
      const now = Date.now();

      // Rate-limit: query IP partition for last hour (sk is numeric timestamp)
      const since = now - RATE_LIMIT_WINDOW_MS;
      const rate = await ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "#pk = :pk AND #sk >= :since",
        ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
        ExpressionAttributeValues: { ":pk": `IP#${ip}`, ":since": since },
        Select: "COUNT"
      }));
      if ((rate.Count || 0) >= RATE_LIMIT_MAX) {
        return json(429, { error: "Too many votes. Please wait before voting again." });
      }

      // Fetch both company records (NOTE: sk: 0)
      const bg = await ddb.send(new BatchGetCommand({
        RequestItems: {
          [TABLE]: {
            Keys: [
              { pk: `COMPANY#${winnerId}`, sk: 0 },
              { pk: `COMPANY#${loserId}`,  sk: 0 }
            ],
            ProjectionExpression: "id, #n, logo, score",
            ExpressionAttributeNames: { "#n": "name" }
          }
        }
      }));
      const items = bg.Responses?.[TABLE] || [];
      const byKey = new Map(items.map(i => [`${i.pk}|${i.sk}`, i]));
      const winner = byKey.get(`COMPANY#${winnerId}|0`);
      const loser  = byKey.get(`COMPANY#${loserId}|0`);
      if (!winner || !loser) return json(400, { error: "Invalid IDs" });

      // Elo calc
      const ws = winner.score ?? 500, ls = loser.score ?? 500;
      const expectedWinner = 1 / (1 + Math.pow(10, (ls - ws) / 400));
      const k = 32;
      const change = Math.round(k * (1 - expectedWinner));
      const newWinner = Math.max(ws + change, 100);
      const newLoser  = Math.max(ls - Math.floor(change * 0.5), 100);

      // Tx: record vote (pk=IP#..., sk=timestamp) + update both scores (sk: 0)
      const ttl = Math.floor((now + 90 * 24 * 3600 * 1000) / 1000);
      await ddb.send(new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: TABLE,
              Item: {
                pk: `IP#${ip}`,
                sk: now, // Number
                entity: "VOTE",
                winner_id: winnerId,
                loser_id: loserId,
                user_agent: userAgent,
                created_at: now,
                ttl
              }
            }
          },
          {
            Update: {
              TableName: TABLE,
              Key: { pk: `COMPANY#${winnerId}`, sk: 0 },
              UpdateExpression: "SET #s = :nw, gsi1pk = :lb, gsi1sk = :nw",
              ExpressionAttributeNames: { "#s": "score" },
              ExpressionAttributeValues: { ":nw": newWinner, ":lb": "LEADERBOARD" }
            }
          },
          {
            Update: {
              TableName: TABLE,
              Key: { pk: `COMPANY#${loserId}`, sk: 0 },
              UpdateExpression: "SET #s = :nl, gsi1pk = :lb, gsi1sk = :nl",
              ExpressionAttributeNames: { "#s": "score" },
              ExpressionAttributeValues: { ":nl": newLoser, ":lb": "LEADERBOARD" }
            }
          }
        ]
      }));

      return json(200, { success: true, scoreChange: change, winnerScore: newWinner, loserScore: newLoser });
    }

    // GET /api/stats
    if (method === "GET" && path.endsWith("/api/stats")) {
      // cheap counts: votes don't have gsi1pk; companies do
      const votes = await ddb.send(new ScanCommand({
        TableName: TABLE,
        Select: "COUNT",
        FilterExpression: "attribute_not_exists(gsi1pk)"
      }));
      const comps = await ddb.send(new QueryCommand({
        TableName: TABLE,
        IndexName: "GSI2",
        KeyConditionExpression: "gsi2pk = :t",
        ExpressionAttributeValues: { ":t": "COMPANY" },
        Select: "COUNT"
      }));
      return json(200, { totalVotes: votes.Count || 0, totalCompanies: comps.Count || 0 });
    }

    // Root
    if (method === "GET" && (path === "/" || path === "")) {
      return html(200, "<h1>FAANGArena API</h1><p>Call /api/* endpoints from your S3 site.</p>");
    }

    return json(404, { error: "Not found" });
  } catch (e) {
    console.error(e);
    return json(500, { error: "Something went wrong!" });
  }
};

// helpers
function pickTwo(arr){ const i=Math.floor(Math.random()*arr.length); let j=Math.floor(Math.random()*(arr.length-1)); if(j>=i) j++; return [arr[i],arr[j]]; }
function clientIp(event){ const h=event.headers||{}; return h["x-forwarded-for"]?.split(",")[0]?.trim()||h["x-real-ip"]||event.requestContext?.http?.sourceIp||"0.0.0.0"; }
function corsHeaders(extra={}){ return { "content-type":"application/json","access-control-allow-origin":"*","access-control-allow-methods":"GET,POST,OPTIONS","access-control-allow-headers":"content-type,authorization", ...extra }; }
function json(statusCode,data){ return { statusCode, headers: corsHeaders(), body: JSON.stringify(data) }; }
function html(statusCode,markup){ return { statusCode, headers: corsHeaders({"content-type":"text/html"}), body: markup }; }
function cors(){ return { statusCode:204, headers: corsHeaders(), body:"" }; }
