# ShyTalk Worker API Contract

> Single source of truth for all API endpoints. Both frontend (admin panel)
> and client (Android/iOS) code MUST reference this document when building
> request/response handling.

## Conventions

- **Auth**: All endpoints require Firebase ID token (`Authorization: Bearer <token>`), except `/api/health`
- **Admin**: Routes with `requireAdmin` check `userType: 'admin'` on the caller's Firestore user doc
- **Errors**: `{ "error": "<message>" }` with appropriate HTTP status code
- **Success**: Most mutations return `{ "success": true, ...counts }` — always include relevant counts

## Health

| Method | Path | Auth | Response |
|--------|------|------|----------|
| GET | `/api/health` | None | `{ status, firestoreAvailable, timestamp }` |

---

## Users (`routes/users.js`)

| Method | Path | Auth | Request Body | Response |
|--------|------|------|-------------|----------|
| GET | `/api/users/:uid` | User | — | `{ uid, displayName, profilePhotoUrl, blockedUserIds[], followingIds[], followerIds[], ... }` |
| PATCH | `/api/users/:uid` | Self | `{ displayName?, bio?, country?, ... }` | `{ success: true }` |
| POST | `/api/users` | Self | `{ uid, displayName?, profilePhotoUrl? }` | `{ success: true, created: boolean }` |
| POST | `/api/users/:uid/unique-id` | Self | — | `{ uniqueId: number }` |
| POST | `/api/users/:uid/appeal` | Self | `{ appealText: string }` | `{ success: true }` |
| POST | `/api/users/:uid/lift-suspension` | Self | — | `{ success: true }` |
| POST | `/api/users/:uid/follow` | Self | `{ targetUserId: string }` | `{ success: true }` |
| POST | `/api/users/:uid/unfollow` | Self | `{ targetUserId: string }` | `{ success: true }` |
| POST | `/api/users/:uid/remove-follower` | Self | `{ followerUserId: string }` | `{ success: true }` |
| POST | `/api/users/:uid/record-visit` | Visitor | `{ visitorId: string }` | `{ success: true }` |

---

## Economy (`routes/economy.js`)

| Method | Path | Auth | Request Body | Response |
|--------|------|------|-------------|----------|
| POST | `/api/economy/daily-reward` | User | — | `{ coinsAwarded, newStreak, isMilestone, newBalance, giftId?, giftQuantity? }` |
| POST | `/api/economy/gacha` | User | `{ pullCount: 1\|10\|100 }` | `{ gifts[], coinsSpent, newBalance, newPityCounter, newLuckScore }` |
| POST | `/api/economy/gift` | User | `{ recipientId, giftId, quantity? }` | `{ success, beansAwarded, recipientBeans, newBalance }` |
| POST | `/api/economy/gift-direct` | User | `{ recipientId, giftId, quantity? }` | `{ success, beansAwarded, newBalance }` |
| POST | `/api/economy/gift-batch` | User | `{ gifts: [{recipientId, giftId, quantity?}] }` | `{ success, totalBeansAwarded, newBalance }` |
| POST | `/api/economy/backpack-send` | User | `{ recipientId }` | `{ success, totalBeansAwarded, newBalance, itemsSent }` |
| POST | `/api/economy/redeem-beans` | User | `{ beans: number }` | `{ success, coinsAwarded, newBalance, beansRemaining }` |
| POST | `/api/economy/purchase` | User | `{ packageId, token }` | `{ success, newBalance }` |
| GET | `/api/economy/balance` | User | — | `{ shyCoins, shyBeans, isSuperShy, superShyExpiry? }` |
| GET | `/api/economy/transactions` | User | — | `[{ id, type, amount, currency, balanceAfter, details, timestamp }]` |
| GET | `/api/users/:uid/backpack` | User | — | `[{ giftId, quantity, lastAcquired, expiresAt? }]` |
| GET | `/api/users/:uid/gift-wall` | User | — | `[{ giftId, receivedCount, senders }]` |
| GET | `/api/users/:uid/gift-wall/:giftId/senders` | User | — | `{ giftId, senders[] }` |

---

## Config (`routes/config.js`)

| Method | Path | Auth | Response |
|--------|------|------|----------|
| GET | `/api/config/:key` | User | Config document fields |
| PUT | `/api/config/:key` | Admin | `{ success: true }` |
| GET | `/api/gifts` | User | Active gifts array |
| GET | `/api/gifts/all` | User | All gifts array |
| GET | `/api/coin-packages` | User | Active coin packages array |
| GET | `/api/broadcasts` | User | Recent broadcasts array |
| GET | `/api/gift-rankings/:giftId` | User | `{ rankings[], totalSent, lastUpdated }` |
| PUT | `/api/config/economy` | Admin | Merged config object |

---

## Conversations (`routes/conversations.js`)

| Method | Path | Auth | Request Body | Response |
|--------|------|------|-------------|----------|
| POST | `/api/conversations/:id/messages` | User | `{ type?, senderId?, text?, imageUrls?, ... }` | Message object |
| GET | `/api/conversations/:id/messages` | User | — | Messages array (oldest first) |

---

## Rooms (`routes/rooms.js`)

| Method | Path | Auth | Request Body | Response |
|--------|------|------|-------------|----------|
| POST | `/api/rooms/:roomId/invites/send` | User | `{ userId, invitedBy }` | `{ success: true }` |
| POST | `/api/rooms/:roomId/seat-requests` | User | `{ seatIndex, userName? }` | `{ requestId }` |

---

## LiveKit (`routes/livekit.js`)

| Method | Path | Auth | Request Body | Response |
|--------|------|------|-------------|----------|
| POST | `/api/livekit/token` | User | `{ roomName, identity }` | `{ token }` |

---

## Notifications (`routes/notifications.js`)

| Method | Path | Auth | Request Body | Response |
|--------|------|------|-------------|----------|
| POST | `/api/notifications/token` | User | `{ token }` | `{ success: true }` |
| DELETE | `/api/notifications/token` | User | `{ token }` | `{ success: true }` |
| PATCH | `/api/notifications/settings` | User | `{ pmNotificationsEnabled?, ... }` | `{ success: true }` |

---

## Reports (`routes/reports.js`)

| Method | Path | Auth | Request Body | Response |
|--------|------|------|-------------|----------|
| POST | `/api/reports` | User | `{ reportedUserId, reason, description?, evidenceUrls? }` | `{ success, reportId }` |
| GET | `/api/reports` | Admin | — | Reports array |
| POST | `/api/reports/:id/resolve` | Admin | `{ action, reason? }` | `{ success: true }` |
| POST | `/api/reports/resolve-all/:userId` | Admin | `{ action, reason? }` | `{ success, resolved }` |
| GET | `/api/reports/stats` | Admin | — | `{ pendingCount, resolvedToday, avgResponseHours, activeReviewers[] }` |
| GET | `/api/reports/export` | Admin | — | CSV download |
| POST | `/api/reports/:id/lock` | Admin | — | `{ success: true }` |
| DELETE | `/api/reports/:id/lock` | Admin | — | `{ success: true }` |

---

## Banners (`routes/banners.js`)

| Method | Path | Auth | Response |
|--------|------|------|----------|
| GET | `/api/banners/active` | User | Active banners array |
| GET | `/api/admin/banners` | Admin | All banners array |
| POST | `/api/admin/banners` | Admin | `{ success, id }` |
| PUT | `/api/admin/banners/reorder` | Admin | `{ success: true }` |
| PUT | `/api/admin/banners/:id` | Admin | `{ success: true }` |
| DELETE | `/api/admin/banners/:id` | Admin | `{ success: true }` |
| POST | `/api/admin/banners/upload` | Admin | `{ success, imageUrl, key }` |

---

## Fun Facts (`routes/fun-facts.js`)

| Method | Path | Auth | Response |
|--------|------|------|----------|
| GET | `/api/fun-facts` | User | Active fun facts array (shuffled) |
| GET | `/api/admin/fun-facts` | Admin | All fun facts array |
| POST | `/api/admin/fun-facts` | Admin | `{ success, id }` |
| PUT | `/api/admin/fun-facts/:id` | Admin | `{ success: true }` |
| DELETE | `/api/admin/fun-facts/:id` | Admin | `{ success: true }` |

---

## Admin Users (`routes/admin-users.js`)

| Method | Path | Auth | Response |
|--------|------|------|----------|
| GET | `/api/user/:uid` | Admin | User object |
| PATCH | `/api/user/:uid` | Admin | `{ success: true }` |
| POST | `/api/user/:uid/warn` | Admin | `{ success, newGcs, deduction, warningCount }` |
| POST | `/api/user/:uid/reset-gcs` | Admin | `{ success: true }` |
| POST | `/api/user/:uid/suspend` | Admin | `{ success: true }` |
| POST | `/api/user/:uid/unsuspend` | Admin | `{ success: true }` |
| GET | `/api/search/uniqueId/:id` | Admin | User object |
| POST | `/api/resolve/uids-to-uniqueIds` | Admin | `{ mapping }` |
| POST | `/api/resolve/uniqueIds-to-uids` | Admin | `{ [uniqueId]: uid }` |
| POST | `/api/report-locks/:uid/lock` | Admin | `{ success, displayName }` |
| DELETE | `/api/report-locks/:uid` | Admin | `{ success: true }` |

---

## Admin Cleanup (`routes/admin-cleanup.js`)

| Method | Path | Auth | Response |
|--------|------|------|----------|
| POST | `/api/cleanup/system-conversations` | Admin | `{ success, deleted }` |
| POST | `/api/cleanup/all-system-conversations` | Admin | `{ success, deleted }` |
| POST | `/api/cleanup/all-reports` | Admin | `{ success: true }` |
| POST | `/api/cleanup/all-warnings` | Admin | `{ success, affected }` |
| POST | `/api/cleanup/all-backpacks` | Admin | `{ success, deleted }` |
| POST | `/api/cleanup/all-giftwalls` | Admin | `{ success, deleted }` |
| POST | `/api/cleanup/all-coins` | Admin | `{ success, affected }` |
| POST | `/api/cleanup/all-beans` | Admin | `{ success, affected }` |
| POST | `/api/cleanup/all-spin-history` | Admin | `{ success, pityReset, txDeleted }` |
| POST | `/api/cleanup/all-supershy` | Admin | `{ success, affected }` |
| POST | `/api/cleanup/all-appeals` | Admin | `{ success, deleted }` |
| GET | `/api/storage/audit` | Admin | `{ folders: { [name]: { count, bytes } }, totalFiles, totalBytes }` |
| POST | `/api/cleanup/orphaned-storage` | Admin | `{ success, summary: { [name]: { total, deleted } }, totalDeleted }` |
| POST | `/api/cleanup/destroyed-users` | Admin | `{ success, destroyed, intact, deletedUids[] }` |
| POST | `/api/cleanup/all-device-bindings` | Admin | `{ success, deleted }` |
| POST | `/api/cleanup/device-binding/:uid` | Admin | `{ success, deleted }` |

---

## Admin Backups (`routes/admin-backup.js`)

| Method | Path | Auth | Response |
|--------|------|------|----------|
| GET | `/api/admin/backups` | Admin | `{ backups: [{ key, date, size, uploaded, userCount }] }` |
| POST | `/api/admin/backups/trigger` | Admin | `{ message, key, bytes }` |
| GET | `/api/admin/backups/:date` | Admin | Raw JSON backup file |
| POST | `/api/admin/backups/restore/:date` | Admin | `{ message, mode, date, restoredCount, totalInBackup }` |
| POST | `/api/admin/backups/recover-photos` | Admin | `{ message, recovered }` |

---

## Admin Economy (`routes/admin-economy.js`)

| Method | Path | Auth | Response |
|--------|------|------|----------|
| GET | `/api/users/:uid/economy` | Admin | Economy fields object |
| POST | `/api/users/:uid/adjust-balance` | Admin | `{ success, newBalance, currency }` |
| POST | `/api/users/:uid/backpack` | Admin | `{ success: true }` |
| GET | `/api/users/:uid/luck` | Admin | `{ luckScore, pityCounter }` |
| POST | `/api/users/:uid/luck` | Admin | `{ success: true }` |
| GET | `/api/users/:uid/transactions` | Admin | Transactions array |
| GET | `/api/users/:uid/guarantee-next-pull` | Admin | `{ guaranteedGiftId, gift? }` |
| POST | `/api/users/:uid/guarantee-next-pull` | Admin | `{ success: true }` |
| DELETE | `/api/users/:uid/guarantee-next-pull` | Admin | `{ success: true }` |

---

## Admin Gifts (`routes/admin-gifts.js`)

| Method | Path | Auth | Response |
|--------|------|------|----------|
| POST | `/api/gifts` | Admin | `{ success, id }` |
| PUT | `/api/gifts/:id` | Admin | `{ success: true }` |
| DELETE | `/api/gifts/:id` | Admin | `{ success: true }` |
| POST | `/api/gifts/seed` | Admin | `{ success, count }` |

---

## Cron Triggers

| Schedule | Handler | Description |
|----------|---------|-------------|
| `0 3 * * SUN` | archiveOldReports | Sunday 03:00 UTC |
| `0 4 * * *` | cleanupOrphanedStorage | Daily 04:00 UTC |
| `0 0 * * *` | checkSubscriptionStatus + cleanExpiredBackpackItems | Daily 00:00 UTC |
| `*/5 * * * *` | closeStaleOwnerAwayRooms | Every 5 minutes |
| `0 2 * * *` | backupUserProfiles | Daily 02:00 UTC |
