# How roles are enforced

The roles and access levels themselves are in [permissions.md](permissions.md). This
file is about *where* they are enforced in each target.

Right now they are enforced in neither. `permissions.md` is prose; nothing in
Zoho or in the SQL reads it.

## In Zoho

Zoho splits this into three separate things, and all three are needed.

### 1. Profiles — what tables and fields you can touch

One profile per role: Admin, Admissions, Coordinator, Teacher, Accounts. For each
module the profile sets view / create / edit / delete, which is exactly what the
table in `permissions.md` describes.

Profiles also do field-level security. That is how "Accounts can edit fees but
not the rest of the enrollment" works: the fee and payment fields are read-write
for that profile, everything else read-only.

### 2. Roles — whose *records* you can see

Separate from profiles, and easy to confuse with them. A profile says "you may
edit Attendance"; the role hierarchy says "you may edit *these* attendance
records". Set the sharing model to Private and each user sees only records they
own, plus those of people below them in the hierarchy.

### 3. Sharing rules — the "own classes" part

The awkward one. No profile can express "a teacher marks attendance only for
their own classes", because that depends on the Allocation records rather than on
the module. Options, roughly in order of preference:

- Set the record **Owner** on Class_Sessions and Attendance to the allocated
  teacher, then let Private sharing do the work.
- A custom function on save that rejects the write when the user has no
  Allocation for that class.
- Territories, if the split is by campus or branch rather than by teacher.

The web tabs change none of this. They run as the logged-in user, so Zoho applies
the same profile and sharing rules there as in the CRM UI.

## In a normal fullstack app

Zoho gives you profiles and roles for free. In your own app you build them, and
**the current schema has no users or roles tables** — a real gap in the fullstack
target, since `teachers.crm_user` only holds a Zoho user id.

Roughly what is needed:

```
app_users     id, email, password_hash, teacher_id (nullable)
roles         id, name          -- admin, admissions, coordinator, teacher, accounts
user_roles    user_id, role_id  -- a person can hold more than one
```

Then enforcement, in one of two places.

### API middleware — the usual approach

Each endpoint declares what it needs:

```
POST /attendance    requires 'attendance:create'
```

and for the "own classes" rule the handler checks the data:

```sql
-- may this user mark attendance on this session?
SELECT 1 FROM allocations a
JOIN class_sessions s ON s.class_id = a.class_id
WHERE s.id = $1 AND a.teacher_id = $2 AND a.status = 'Active'
```

### Or Postgres row-level security

The rule sits in the database, so it holds even if someone queries directly:

```sql
CREATE POLICY teacher_own_attendance ON attendance
  FOR ALL USING (
    class_id IN (SELECT class_id FROM allocations
                 WHERE teacher_id = current_setting('app.teacher_id')::bigint)
  );
```

RLS is stricter and harder to bypass; middleware is easier to read and debug. For
a school-sized system, middleware first, and RLS later only if direct database
access becomes a worry.

## The two sides compared

| | Zoho | Fullstack |
|---|---|---|
| Table access | Profiles | `roles` + middleware checks |
| Field access | Field-level security in the profile | Pick fields per role in the API |
| Record access | Role hierarchy + record owner | `WHERE` clauses, or RLS policies |
| "Own classes" | Sharing rules or a custom function | A join against `allocations` |
| Where it is configured | CRM Setup screens, by hand | Code and migrations |
| Who can change it | Any Zoho admin, silently | Requires a commit and a deploy |

That last row is the practical difference. In Zoho someone can widen a profile
with a few clicks and nothing records why; in your own app it is a reviewable
change.

## Open suggestion

`permissions.md` is prose, so the two targets will drift the moment anyone edits a
Zoho profile. The same approach used for the fields would fix it: a
`schema/permissions.yaml` listing each role and its access, generating the Zoho
profile payloads, the SQL policies, and the markdown table.

Not built — it is speculative until the modules exist in demo 4. The alternative,
keeping permissions as a document people read, is also a reasonable call.
