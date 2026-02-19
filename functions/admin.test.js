/**
 * Tests for admin.js — ShyTalk Admin API
 *
 * Mocks firebase-admin so tests run without a real project.
 */

// ── Mock data stores (must be prefixed with "mock") ─────────────────
let mockUsers = {};
let mockReports = {};
let mockReportsArchive = {};
let mockConversations = {};
let mockMessages = {};
let mockAuditLog = {};
let mockReportLocks = {};
let mockAdminTokens = {};
let mockSuspensionAppeals = {};
let mockStorageFiles = {};
let mockDocIdCounter = 0;

// Helper to build Firestore Timestamp-like object
function mockFakeTimestamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  return { toDate: () => d, _seconds: Math.floor(d.getTime() / 1000) };
}

function mockGetStore(path) {
  if (path === "users") return mockUsers;
  if (path === "reports") return mockReports;
  if (path === "reports_archive") return mockReportsArchive;
  if (path === "conversations") return mockConversations;
  if (path === "admin_audit_log") return mockAuditLog;
  if (path === "report_locks") return mockReportLocks;
  if (path === "admin_tokens") return mockAdminTokens;
  if (path === "suspensionAppeals") return mockSuspensionAppeals;
  if (path.includes("/messages")) return mockMessages;
  return {};
}

function mockBuildQuerySnapshot(docs) {
  return {
    empty: docs.length === 0,
    size: docs.length,
    docs: docs.map((d) => ({
      id: d._id,
      data: () => {
        const copy = { ...d };
        delete copy._id;
        delete copy._collection;
        return copy;
      },
      ref: mockBuildDocRef(d._collection || "unknown", d._id),
    })),
  };
}

function mockBuildDocRef(collection, docId) {
  return {
    id: docId,
    get: jest.fn(async () => {
      const store = mockGetStore(collection);
      const data = store[docId];
      return {
        exists: !!data,
        id: docId,
        data: () => (data ? { ...data } : undefined),
        ref: mockBuildDocRef(collection, docId),
      };
    }),
    set: jest.fn(async (data, opts) => {
      const store = mockGetStore(collection);
      if (opts && opts.merge) {
        store[docId] = { ...(store[docId] || {}), ...data };
      } else {
        store[docId] = { ...data };
      }
    }),
    update: jest.fn(async (updates) => {
      const store = mockGetStore(collection);
      if (!store[docId]) throw new Error(`Doc ${collection}/${docId} not found`);
      for (const [k, v] of Object.entries(updates)) {
        if (v && v._type === "increment") {
          store[docId][k] = (store[docId][k] || 0) + v._value;
        } else if (v && v._type === "delete") {
          delete store[docId][k];
        } else {
          store[docId][k] = v;
        }
      }
    }),
    delete: jest.fn(async () => {
      const store = mockGetStore(collection);
      delete store[docId];
    }),
    collection: (subCol) => mockBuildCollectionRef(`${collection}/${docId}/${subCol}`),
  };
}

function mockBuildQuery(path, filters) {
  return {
    where: (...args) => mockBuildQuery(path, [...filters, args]),
    limit: () => mockBuildQuery(path, filters),
    get: jest.fn(async () => {
      const store = mockGetStore(path);
      let entries = Object.entries(store).map(([id, data]) => ({
        _id: id,
        _collection: path,
        ...data,
      }));

      for (const [field, op, value] of filters) {
        entries = entries.filter((entry) => {
          const fieldValue = entry[field];
          switch (op) {
            case "==": return JSON.stringify(fieldValue) === JSON.stringify(value);
            case ">=": return fieldValue >= value;
            case "<=": return fieldValue <= value;
            case "<": return fieldValue < value;
            case "in": return value.includes(fieldValue);
            case "array-contains": return Array.isArray(fieldValue) && fieldValue.includes(value);
            default: return true;
          }
        });
      }

      return mockBuildQuerySnapshot(entries);
    }),
  };
}

function mockBuildCollectionRef(path) {
  return {
    doc: (id) => {
      const docId = id || `auto_${++mockDocIdCounter}`;
      return mockBuildDocRef(path, docId);
    },
    where: (...args) => mockBuildQuery(path, [args]),
    add: jest.fn(async (data) => {
      const store = mockGetStore(path);
      const id = `auto_${++mockDocIdCounter}`;
      store[id] = { ...data };
      return { id };
    }),
    get: jest.fn(async () => {
      const store = mockGetStore(path);
      const docs = Object.entries(store).map(([id, data]) => ({
        _id: id,
        _collection: path,
        ...data,
      }));
      return mockBuildQuerySnapshot(docs);
    }),
    limit: () => mockBuildQuery(path, []),
  };
}

const mockBatch = {
  update: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  commit: jest.fn().mockResolvedValue(),
};

// ── Mock firebase-admin/auth ────────────────────────────────────────
const mockVerifyIdToken = jest.fn();
const mockRevokeRefreshTokens = jest.fn().mockResolvedValue();

jest.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: mockVerifyIdToken,
    revokeRefreshTokens: mockRevokeRefreshTokens,
  }),
}));

// ── Mock firebase-admin/firestore ───────────────────────────────────
jest.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: (name) => mockBuildCollectionRef(name),
    batch: () => mockBatch,
    getAll: jest.fn(async (...refs) => {
      return refs.map((ref) => {
        const data = mockUsers[ref.id];
        return {
          exists: !!data,
          id: ref.id,
          data: () => (data ? { ...data } : undefined),
        };
      });
    }),
  }),
  Timestamp: {
    now: () => mockFakeTimestamp(new Date()),
    fromDate: (d) => mockFakeTimestamp(d),
  },
  FieldValue: {
    increment: (n) => ({ _type: "increment", _value: n }),
    delete: () => ({ _type: "delete" }),
    serverTimestamp: () => mockFakeTimestamp(new Date()),
  },
}));

// ── Mock firebase-admin/storage ─────────────────────────────────────
jest.mock("firebase-admin/storage", () => ({
  getStorage: () => ({
    bucket: () => ({
      getFiles: jest.fn(async ({ prefix }) => {
        const files = Object.entries(mockStorageFiles)
          .filter(([k]) => k.startsWith(prefix))
          .map(([k]) => ({
            name: k,
            delete: jest.fn(async () => { delete mockStorageFiles[k]; }),
            getMetadata: jest.fn(async () => [{ size: "1024" }]),
          }));
        return [files];
      }),
      file: (path) => ({
        delete: jest.fn(async () => { delete mockStorageFiles[path]; }),
      }),
    }),
  }),
}));

// ── Load admin app after mocks ──────────────────────────────────────
const http = require("http");
let app;
let server;

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const options = {
      hostname: "127.0.0.1",
      port: addr.port,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token !== null ? { Authorization: `Bearer ${token}` } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Setup / Teardown ────────────────────────────────────────────────
beforeAll((done) => {
  app = require("./admin");
  server = http.createServer(app);
  server.listen(0, "127.0.0.1", done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  mockUsers = {};
  mockReports = {};
  mockReportsArchive = {};
  mockConversations = {};
  mockMessages = {};
  mockAuditLog = {};
  mockReportLocks = {};
  mockAdminTokens = {};
  mockSuspensionAppeals = {};
  mockStorageFiles = {};
  mockDocIdCounter = 0;

  mockVerifyIdToken.mockResolvedValue({ uid: "admin-1", admin: true, name: "Admin One", email: "admin@test.com" });
  mockRevokeRefreshTokens.mockResolvedValue();
  mockBatch.commit.mockResolvedValue();
  mockBatch.update.mockReset();
  mockBatch.set.mockReset();
  mockBatch.delete.mockReset();
});

// ── Auth Middleware Tests ────────────────────────────────────────────
describe("Auth Middleware", () => {
  test("returns 401 when no Authorization header", async () => {
    const res = await request("GET", "/api/user/test-uid", null, null);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Missing/i);
  });

  test("returns 401 when invalid token", async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error("invalid token"));
    const res = await request("GET", "/api/user/test-uid", null, "bad-token");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid/i);
  });

  test("returns 403 when not admin", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: "user-1", admin: false });
    const res = await request("GET", "/api/user/test-uid", null, "valid-non-admin");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Not an admin/i);
  });
});

// ── GCS Reset ───────────────────────────────────────────────────────
describe("POST /api/user/:uid/reset-gcs", () => {
  test("sets score to 100 and clears warning count", async () => {
    mockUsers["user-1"] = {
      displayName: "Bad User",
      goodCharacterScore: 40,
      goodCharacterLastDeductionAt: mockFakeTimestamp(new Date()),
      warningCount: 3,
    };

    const res = await request("POST", "/api/user/user-1/reset-gcs", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockUsers["user-1"].goodCharacterScore).toBe(100);
    expect(mockUsers["user-1"].goodCharacterLastDeductionAt).toBeNull();
    expect(mockUsers["user-1"].warningCount).toBe(0);
  });

  test("returns 404 for non-existent user", async () => {
    const res = await request("POST", "/api/user/no-one/reset-gcs", {}, "valid");
    expect(res.status).toBe(404);
  });
});

// ── GET /api/reports ────────────────────────────────────────────────
describe("GET /api/reports", () => {
  test("returns empty list when no reports", async () => {
    const res = await request("GET", "/api/reports?status=pending", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.users).toEqual([]);
  });

  test("groups reports by reportedUserId", async () => {
    mockReports["r1"] = {
      reportedUserId: "user-1",
      reporterId: "reporter-1",
      reason: "Spam",
      status: "pending",
    };
    mockReports["r2"] = {
      reportedUserId: "user-1",
      reporterId: "reporter-2",
      reason: "Harassment",
      status: "pending",
    };
    mockUsers["user-1"] = {
      displayName: "Bad User",
      uniqueId: 42,
      goodCharacterScore: 80,
      warningCount: 1,
    };

    const res = await request("GET", "/api/reports?status=pending", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBe(1);
    expect(res.body.users[0].uid).toBe("user-1");
    expect(res.body.users[0].reportCount).toBe(2);
    expect(res.body.users[0].warningCount).toBe(1);
  });

  test("rejects invalid status", async () => {
    const res = await request("GET", "/api/reports?status=invalid", null, "valid");
    expect(res.status).toBe(400);
  });
});

// ── POST /api/reports/:id/resolve ───────────────────────────────────
describe("POST /api/reports/:id/resolve", () => {
  beforeEach(() => {
    mockReports["report-1"] = {
      reportedUserId: "user-1",
      reporterId: "reporter-1",
      reason: "Harassment",
      status: "pending",
    };
    mockUsers["user-1"] = {
      displayName: "Offender",
      goodCharacterScore: 100,
      goodCharacterLastDeductionAt: null,
      warningCount: 0,
    };
  });

  test("rejects invalid action", async () => {
    const res = await request("POST", "/api/reports/report-1/resolve", { action: "ban" }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/action/i);
  });

  test("rejects missing severity for warn", async () => {
    const res = await request("POST", "/api/reports/report-1/resolve", { action: "warn" }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/severity/i);
  });

  test("rejects severity out of range", async () => {
    const res = await request("POST", "/api/reports/report-1/resolve", { action: "warn", severity: 6 }, "valid");
    expect(res.status).toBe(400);
  });

  test("returns 404 for non-existent report", async () => {
    const res = await request("POST", "/api/reports/fake/resolve", { action: "dismiss" }, "valid");
    expect(res.status).toBe(404);
  });

  test("rejects already resolved report", async () => {
    mockReports["report-1"].status = "resolved";
    const res = await request("POST", "/api/reports/report-1/resolve", { action: "dismiss" }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already resolved/i);
  });

  test("dismiss resolves report without GCS deduction", async () => {
    const res = await request("POST", "/api/reports/report-1/resolve", {
      action: "dismiss",
      adminNote: "False report",
    }, "valid");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockReports["report-1"].status).toBe("resolved");
    expect(mockReports["report-1"].resolvedAction).toBe("dismiss");
    expect(mockUsers["user-1"].goodCharacterScore).toBe(100);
  });

  test("warn deducts GCS, sets warning fields, revokes tokens", async () => {
    const res = await request("POST", "/api/reports/report-1/resolve", {
      action: "warn",
      severity: 3,
      adminNote: "Warned for harassment",
    }, "valid");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(mockReports["report-1"].status).toBe("resolved");
    expect(mockReports["report-1"].resolvedAction).toBe("warn");
    expect(mockReports["report-1"].severity).toBe(3);

    // GCS: 100 - (3*5) = 85
    expect(mockUsers["user-1"].goodCharacterScore).toBe(85);
    expect(mockUsers["user-1"].hasActiveWarning).toBe(true);
    expect(mockUsers["user-1"].warningReason).toBe("Harassment");
    expect(mockRevokeRefreshTokens).toHaveBeenCalledWith("user-1");
  });

  test("warn severity 5 deducts 25 points", async () => {
    const res = await request("POST", "/api/reports/report-1/resolve", {
      action: "warn",
      severity: 5,
    }, "valid");
    expect(res.status).toBe(200);
    expect(mockUsers["user-1"].goodCharacterScore).toBe(75);
  });

  test("GCS does not go below 0", async () => {
    mockUsers["user-1"].goodCharacterScore = 10;
    const res = await request("POST", "/api/reports/report-1/resolve", {
      action: "warn",
      severity: 5,
    }, "valid");
    expect(res.status).toBe(200);
    expect(mockUsers["user-1"].goodCharacterScore).toBe(0);
  });

  test("auto-escalation suggested when warningCount reaches 5", async () => {
    mockUsers["user-1"].warningCount = 4;
    const res = await request("POST", "/api/reports/report-1/resolve", {
      action: "warn",
      severity: 1,
    }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.autoEscalateSuggested).toBe(true);
  });

  test("no auto-escalation when warningCount below 5", async () => {
    mockUsers["user-1"].warningCount = 2;
    const res = await request("POST", "/api/reports/report-1/resolve", {
      action: "warn",
      severity: 1,
    }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.autoEscalateSuggested).toBe(false);
  });

  test("suspend triggers suspension and GCS deduction", async () => {
    const res = await request("POST", "/api/reports/report-1/resolve", {
      action: "suspend",
      severity: 4,
      suspensionDays: 7,
      canAppeal: true,
    }, "valid");

    expect(res.status).toBe(200);
    expect(mockUsers["user-1"].goodCharacterScore).toBe(80);
    expect(mockUsers["user-1"].isSuspended).toBe(true);
    expect(mockUsers["user-1"].suspensionCanAppeal).toBe(true);
  });

  test("dismiss does not require severity", async () => {
    const res = await request("POST", "/api/reports/report-1/resolve", {
      action: "dismiss",
    }, "valid");
    expect(res.status).toBe(200);
  });
});

// ── POST /api/reports/resolve-all/:reportedUserId ───────────────────
describe("POST /api/reports/resolve-all/:reportedUserId", () => {
  beforeEach(() => {
    mockReports["r1"] = {
      reportedUserId: "user-1",
      reporterId: "reporter-1",
      reason: "Spam",
      status: "pending",
    };
    mockReports["r2"] = {
      reportedUserId: "user-1",
      reporterId: "reporter-2",
      reason: "Harassment",
      status: "pending",
    };
    mockUsers["user-1"] = {
      displayName: "Offender",
      goodCharacterScore: 100,
      goodCharacterLastDeductionAt: null,
      warningCount: 0,
    };
  });

  test("returns 404 when no pending reports", async () => {
    const res = await request("POST", "/api/reports/resolve-all/user-999", {
      action: "dismiss",
    }, "valid");
    expect(res.status).toBe(404);
  });

  test("rejects invalid action", async () => {
    const res = await request("POST", "/api/reports/resolve-all/user-1", {
      action: "nuke",
    }, "valid");
    expect(res.status).toBe(400);
  });

  test("bulk warn applies single GCS deduction", async () => {
    const res = await request("POST", "/api/reports/resolve-all/user-1", {
      action: "warn",
      severity: 2,
    }, "valid");

    expect(res.status).toBe(200);
    expect(res.body.resolvedCount).toBe(2);
    // Single deduction: 100 - (2*5) = 90
    expect(mockUsers["user-1"].goodCharacterScore).toBe(90);
    expect(mockUsers["user-1"].hasActiveWarning).toBe(true);
    expect(mockRevokeRefreshTokens).toHaveBeenCalledWith("user-1");
  });
});

// ── Review Lock Endpoints ───────────────────────────────────────────
describe("Review Lock Endpoints", () => {
  test("POST lock creates a new lock", async () => {
    const res = await request("POST", "/api/report-locks/user-1/lock", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.locked).toBe(false);
  });

  test("POST lock returns locked=true when another admin holds it", async () => {
    mockReportLocks["user-1"] = {
      adminUid: "admin-2",
      displayName: "Other Admin",
      timestamp: mockFakeTimestamp(new Date()),
    };

    const res = await request("POST", "/api/report-locks/user-1/lock", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.locked).toBe(true);
    expect(res.body.lockedBy).toBe("Other Admin");
  });

  test("POST lock allows same admin to re-acquire", async () => {
    mockReportLocks["user-1"] = {
      adminUid: "admin-1",
      displayName: "Admin One",
      timestamp: mockFakeTimestamp(new Date()),
    };

    const res = await request("POST", "/api/report-locks/user-1/lock", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.locked).toBe(false);
  });

  test("POST lock allows acquisition after expired lock", async () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    mockReportLocks["user-1"] = {
      adminUid: "admin-2",
      displayName: "Other",
      timestamp: mockFakeTimestamp(tenMinAgo),
    };

    const res = await request("POST", "/api/report-locks/user-1/lock", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.locked).toBe(false);
  });

  test("DELETE lock removes it", async () => {
    mockReportLocks["user-1"] = {
      adminUid: "admin-1",
      displayName: "Admin One",
      timestamp: mockFakeTimestamp(new Date()),
    };

    const res = await request("DELETE", "/api/report-locks/user-1", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ── GET /api/reports/export ─────────────────────────────────────────
describe("GET /api/reports/export", () => {
  test("returns 400 when from/to missing", async () => {
    const res = await request("GET", "/api/reports/export", null, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/from and to/i);
  });

  test("returns 400 for invalid date format", async () => {
    const res = await request("GET", "/api/reports/export?from=bad&to=worse", null, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid date/i);
  });

  test("returns CSV with correct headers", async () => {
    const ts = mockFakeTimestamp(new Date("2025-06-01"));
    mockReports["r1"] = {
      status: "resolved",
      resolvedAt: ts,
      timestamp: ts,
      reporterName: "Reporter",
      reportedUserName: "Offender",
      type: "message",
      reason: "Spam",
      resolvedAction: "warn",
      severity: 2,
      adminNote: "Warned",
    };

    const from = "2025-01-01";
    const to = "2025-12-31";
    const res = await request("GET", `/api/reports/export?from=${from}&to=${to}`, null, "valid");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);

    const lines = res.body.split("\n");
    expect(lines[0]).toBe("Report ID,Reporter,Reported User,Type,Reason,Action Taken,Severity,Admin Note,Created At,Resolved At");
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });
});

// ── GET /api/reports/stats ──────────────────────────────────────────
describe("GET /api/reports/stats", () => {
  test("returns stats with default period", async () => {
    mockReports["r1"] = { status: "pending" };
    mockReports["r2"] = { status: "pending" };

    const res = await request("GET", "/api/reports/stats", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.pendingCount).toBe(2);
    expect(typeof res.body.resolvedToday).toBe("number");
    expect(typeof res.body.activeReviewers).toBe("number");
  });

  test("returns zero stats when empty", async () => {
    const res = await request("GET", "/api/reports/stats?period=30d", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.pendingCount).toBe(0);
    expect(res.body.resolvedToday).toBe(0);
    expect(res.body.activeReviewers).toBe(0);
  });
});

// ── Existing Endpoints (regression) ─────────────────────────────────
describe("Existing Endpoints Regression", () => {
  test("GET /api/user/:uid returns user data", async () => {
    mockUsers["user-1"] = { displayName: "Alice", uniqueId: 123 };
    const res = await request("GET", "/api/user/user-1", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe("Alice");
    expect(res.body.uid).toBe("user-1");
  });

  test("GET /api/user/:uid returns 404 for missing user", async () => {
    const res = await request("GET", "/api/user/nobody", null, "valid");
    expect(res.status).toBe(404);
  });

  test("PATCH /api/user/:uid updates user fields", async () => {
    mockUsers["user-1"] = { displayName: "Alice", uniqueId: 123 };
    const res = await request("PATCH", "/api/user/user-1", { displayName: "Bob" }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockUsers["user-1"].displayName).toBe("Bob");
  });

  test("PATCH /api/user/:uid rejects unknown fields", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };
    const res = await request("PATCH", "/api/user/user-1", { badField: "value" }, "valid");
    expect(res.status).toBe(400);
  });

  test("PATCH /api/user/:uid rejects uid mutation", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };
    const res = await request("PATCH", "/api/user/user-1", { uid: "new-id" }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uid is immutable/i);
  });

  test("POST /api/user/:uid/suspend sets suspension fields", async () => {
    mockUsers["user-1"] = { displayName: "Alice", profilePhotoUrl: "url", coverPhotoUrl: "cover" };
    const futureDate = new Date(Date.now() + 7 * 86400000).toISOString();

    const res = await request("POST", "/api/user/user-1/suspend", {
      reason: "Bad behavior",
      endDate: futureDate,
      canAppeal: true,
    }, "valid");

    expect(res.status).toBe(200);
    expect(mockUsers["user-1"].isSuspended).toBe(true);
    expect(mockUsers["user-1"].suspensionReason).toBe("Bad behavior");
    expect(mockUsers["user-1"].suspensionCanAppeal).toBe(true);
  });

  test("POST /api/user/:uid/suspend rejects missing reason", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };
    const res = await request("POST", "/api/user/user-1/suspend", { canAppeal: true }, "valid");
    expect(res.status).toBe(400);
  });

  test("POST /api/user/:uid/unsuspend restores profile", async () => {
    mockUsers["user-1"] = {
      displayName: "Suspended Account",
      isSuspended: true,
      _preSuspension: { displayName: "Alice", profilePhotoUrl: "url", coverPhotoUrl: "cover" },
    };

    const res = await request("POST", "/api/user/user-1/unsuspend", {}, "valid");
    expect(res.status).toBe(200);
    expect(mockUsers["user-1"].isSuspended).toBe(false);
    expect(mockUsers["user-1"].displayName).toBe("Alice");
  });

  test("GET /api/search/uniqueId/:id finds user", async () => {
    mockUsers["user-1"] = { displayName: "Alice", uniqueId: 42 };
    const res = await request("GET", "/api/search/uniqueId/42", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe("Alice");
  });
});

// ── Direct Warning (POST /api/user/:uid/warn) ──────────────────────
describe("POST /api/user/:uid/warn", () => {
  beforeEach(() => {
    mockUsers["target-1"] = {
      displayName: "TargetUser",
      uniqueId: 42,
      goodCharacterScore: 100,
      warningCount: 0,
    };
  });

  test("returns 404 for non-existent user", async () => {
    const res = await request("POST", "/api/user/ghost/warn", { reason: "Spam", severity: 2 }, "valid");
    expect(res.status).toBe(404);
  });

  test("rejects missing reason", async () => {
    const res = await request("POST", "/api/user/target-1/warn", { severity: 2 }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason/i);
  });

  test("rejects invalid severity", async () => {
    const res = await request("POST", "/api/user/target-1/warn", { reason: "Spam", severity: 0 }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/severity/i);
  });

  test("warns user, deducts GCS, sets warning fields", async () => {
    const res = await request("POST", "/api/user/target-1/warn", { reason: "Harassment", severity: 3, adminNote: "test" }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.newGCS).toBe(85); // 100 - 15
    expect(res.body.warningCount).toBe(1);
    expect(mockUsers["target-1"].hasActiveWarning).toBe(true);
    expect(mockUsers["target-1"].warningReason).toBe("Harassment");
    expect(mockUsers["target-1"].goodCharacterScore).toBe(85);
  });

  test("auto-escalation suggested at 5 warnings", async () => {
    mockUsers["target-1"].warningCount = 4;
    const res = await request("POST", "/api/user/target-1/warn", { reason: "Spam", severity: 1 }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.autoEscalateSuggested).toBe(true);
  });

  test("GCS does not go below 0", async () => {
    mockUsers["target-1"].goodCharacterScore = 10;
    const res = await request("POST", "/api/user/target-1/warn", { reason: "Spam", severity: 5 }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.newGCS).toBe(0);
  });

  test("filters 'other' reason to 'a policy violation'", async () => {
    const res = await request("POST", "/api/user/target-1/warn", { reason: "Other", severity: 1 }, "valid");
    expect(res.status).toBe(200);
    expect(mockUsers["target-1"].warningReason).toBe("a policy violation");
  });
});

// ── Field Validation ────────────────────────────────────────────────
describe("Field Validation", () => {
  beforeEach(() => {
    mockUsers["user-1"] = { displayName: "Test", uniqueId: 1 };
  });

  test("rejects non-boolean for boolean fields", async () => {
    const res = await request("PATCH", "/api/user/user-1", { hideFollowing: "yes" }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/hideFollowing must be a boolean/);
  });

  test("rejects invalid userType enum", async () => {
    const res = await request("PATCH", "/api/user/user-1", { userType: "HACKER" }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/userType must be one of/);
  });

  test("accepts valid userType enum", async () => {
    const res = await request("PATCH", "/api/user/user-1", { userType: "MC_SINGER" }, "valid");
    expect(res.status).toBe(200);
    expect(mockUsers["user-1"].userType).toBe("MC_SINGER");
  });

  test("rejects non-string for string fields", async () => {
    const res = await request("PATCH", "/api/user/user-1", { displayName: 123 }, "valid");
    expect(res.status).toBe(400);
  });

  test("accepts null for nullable fields", async () => {
    const res = await request("PATCH", "/api/user/user-1", { profilePhotoUrl: null }, "valid");
    expect(res.status).toBe(200);
  });

  test("rejects null for non-nullable fields", async () => {
    const res = await request("PATCH", "/api/user/user-1", { displayName: null }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot be null/);
  });

  test("validates timestamp fields as ISO-8601", async () => {
    const res = await request("PATCH", "/api/user/user-1", { createdAt: "not-a-date" }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a valid date/);
  });

  test("accepts valid ISO-8601 timestamp", async () => {
    const res = await request("PATCH", "/api/user/user-1", { createdAt: "2025-01-15T10:00:00Z" }, "valid");
    expect(res.status).toBe(200);
  });
});

// ── Storage Cleanup ─────────────────────────────────────────────────
describe("Storage Cleanup", () => {
  test("cleanup all-reports also deletes report_evidence storage", async () => {
    mockReports["r1"] = { status: "pending", reportedUserId: "u1" };
    mockStorageFiles["report_evidence/u1/screenshot.png"] = true;
    mockStorageFiles["report_evidence/u2/video.mp4"] = true;

    const res = await request("POST", "/api/cleanup/all-reports", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.storageFilesDeleted).toBe(2);
    expect(mockStorageFiles["report_evidence/u1/screenshot.png"]).toBeUndefined();
    expect(mockStorageFiles["report_evidence/u2/video.mp4"]).toBeUndefined();
  });

  test("cleanup all-system-conversations deletes PM images from storage", async () => {
    const imgUrl = "https://firebasestorage.googleapis.com/v0/b/shytalk-7ba69.firebasestorage.app/o/pm_images%2Fuser1%2Fimg.jpg?alt=media&token=abc";
    mockConversations["SHYTALK_SYSTEM_user1"] = {
      participantIds: ["SHYTALK_SYSTEM", "user1"],
    };
    mockMessages["msg1"] = {
      senderId: "user1",
      text: "",
      imageUrls: [imgUrl],
    };
    mockStorageFiles["pm_images/user1/img.jpg"] = true;

    const res = await request("POST", "/api/cleanup/all-system-conversations", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.storageFilesDeleted).toBe(1);
  });

  test("GET /api/storage/audit returns folder stats", async () => {
    mockStorageFiles["pm_images/u1/img.jpg"] = true;
    mockStorageFiles["pm_images/u2/img2.jpg"] = true;
    mockStorageFiles["stickers/u1/sticker.webp"] = true;

    const res = await request("GET", "/api/storage/audit", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pm_images.files).toBe(2);
    expect(res.body.pm_images.bytes).toBe(2048);
    expect(res.body.stickers.files).toBe(1);
    expect(res.body.stickers.bytes).toBe(1024);
    expect(res.body.report_evidence.files).toBe(0);
    expect(res.body.profile_photos.files).toBe(0);
    expect(res.body.cover_photos.files).toBe(0);
  });

  test("orphaned-storage deletes only unreferenced files", async () => {
    // Referenced: user profile photo
    const profileUrl = "https://firebasestorage.googleapis.com/v0/b/shytalk-7ba69.firebasestorage.app/o/profile_photos%2Fu1%2Fphoto.jpg?alt=media&token=abc";
    mockUsers["u1"] = { displayName: "User", profilePhotoUrl: profileUrl };
    mockStorageFiles["profile_photos/u1/photo.jpg"] = true;

    // Orphaned files (no Firestore reference)
    mockStorageFiles["pm_images/u2/old.jpg"] = true;
    mockStorageFiles["stickers/u3/stale.webp"] = true;

    const res = await request("POST", "/api/cleanup/orphaned-storage", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Referenced file preserved
    expect(mockStorageFiles["profile_photos/u1/photo.jpg"]).toBe(true);
    // Orphaned files deleted
    expect(mockStorageFiles["pm_images/u2/old.jpg"]).toBeUndefined();
    expect(mockStorageFiles["stickers/u3/stale.webp"]).toBeUndefined();
    expect(res.body.totalDeleted).toBe(2);
  });

  test("orphaned-storage preserves files still referenced in Firestore", async () => {
    // IMAGE message reference
    const imgUrl = "https://firebasestorage.googleapis.com/v0/b/shytalk-7ba69.firebasestorage.app/o/pm_images%2Fu1%2Fimg.jpg?alt=media&token=abc";
    mockConversations["conv1"] = { participantIds: ["u1", "u2"] };
    mockMessages["msg1"] = { senderId: "u1", type: "IMAGE", imageUrls: [imgUrl] };
    mockStorageFiles["pm_images/u1/img.jpg"] = true;

    // STICKER message reference
    const stickerUrl = "https://firebasestorage.googleapis.com/v0/b/shytalk-7ba69.firebasestorage.app/o/stickers%2Fu1%2Fsticker.webp?alt=media&token=def";
    mockMessages["msg2"] = { senderId: "u1", type: "STICKER", stickerUrl };
    mockStorageFiles["stickers/u1/sticker.webp"] = true;

    // Report evidence reference
    const evUrl = "https://firebasestorage.googleapis.com/v0/b/shytalk-7ba69.firebasestorage.app/o/report_evidence%2Fu1%2Fev.png?alt=media&token=xyz";
    mockReports["r1"] = { status: "pending", evidenceUrls: [evUrl] };
    mockStorageFiles["report_evidence/u1/ev.png"] = true;

    // Cover photo in _preSuspension
    const coverUrl = "https://firebasestorage.googleapis.com/v0/b/shytalk-7ba69.firebasestorage.app/o/cover_photos%2Fu1%2Fcover.jpg?alt=media&token=ghi";
    mockUsers["u1"] = { displayName: "User", _preSuspension: { coverPhotoUrl: coverUrl } };
    mockStorageFiles["cover_photos/u1/cover.jpg"] = true;

    const res = await request("POST", "/api/cleanup/orphaned-storage", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.totalDeleted).toBe(0);
    expect(mockStorageFiles["pm_images/u1/img.jpg"]).toBe(true);
    expect(mockStorageFiles["stickers/u1/sticker.webp"]).toBe(true);
    expect(mockStorageFiles["report_evidence/u1/ev.png"]).toBe(true);
    expect(mockStorageFiles["cover_photos/u1/cover.jpg"]).toBe(true);
  });

  test("orphaned-storage deletes unreferenced files from all folders", async () => {
    mockStorageFiles["pm_images/orphan1.jpg"] = true;
    mockStorageFiles["stickers/orphan2.webp"] = true;
    mockStorageFiles["report_evidence/orphan3.png"] = true;
    mockStorageFiles["profile_photos/orphan4.jpg"] = true;
    mockStorageFiles["cover_photos/orphan5.jpg"] = true;
    mockStorageFiles["group_photos/orphan6.jpg"] = true;

    const res = await request("POST", "/api/cleanup/orphaned-storage", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.totalDeleted).toBe(6);
    expect(Object.keys(mockStorageFiles).length).toBe(0);
  });
});
