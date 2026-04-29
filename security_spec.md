# Security Specification for BU Training Portal (LDO)

## 1. Data Invariants
- A **Registration** must always link a valid `userId` (instructor) to a valid `courseId`.
- Only the owner of a registration (the instructor who registered) or an Admin can mark attendance as `true`.
- **Instructors** profiles can only be created by the user owning the profile (UID matching) or an Admin.
- **Courses** can only be created, deleted, or fully modified by Admins. Users can only increment `totalRegistrations`.
- **Evaluation** data is write-only for the user who submitted it and read-only for Admins.

## 2. Access Control Model
- **Public:** `courses` (read-only).
- **Authenticated (BU Account):** 
  - Read/Write their own `instructors` profile.
  - Read/Create/Update their own `registrations`.
  - Create `evaluations`.
- **Admin:** 
  - Full read/write access to all collections.
  - Identified by email `kulachet.l@bu.ac.th` or inclusion in `/admins` collection.

## 3. The Dirty Dozen (Threat Matrix)
| Payload ID | Target Collection | Threat Type | Attack Strategy |
|------------|-------------------|-------------|-----------------|
| T1 | courses | Privilege Escalation | Authenticated user tries to delete a course. |
| T2 | registrations | Identity Spoofing | User A tries to register User B for a course. |
| T3 | registrations | State Bypass | User tries to check in without being registered. |
| T4 | instructors | Data Poisoning | User tries to inject 1MB string into 'name' field. |
| T5 | instructors | PII Lead | Authenticated user tries to list all emails of instructors. |
| T6 | courses | Resource Exhaustion | Creating 10,000 courses with script. |
| T7 | registrations | Double Registration | Creating multiple reg docs for same course/user. |
| T8 | admins | Privilege Escalation | User tries to add themselves to /admins collection. |
| T9 | mail | Spam Relay | User tries to add docs to /mail to send unauthorized emails. |
| T10 | evaluations | Feedback Spoofing | User A modifies User B's evaluation. |
| T11 | courses | Field Injection | User adds 'isVerified: true' to a course doc. |
| T12 | registrations | ID Hijacking | User tries to create 'registrations/random_id' bypassing validation. |
