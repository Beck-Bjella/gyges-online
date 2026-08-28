# Migrations

Every change to the database schema is a numbered file in this folder. They run
in filename order, exactly once each, and each is recorded in the
`schema_migrations` table so it is never applied twice.

```sh
npm run db:migrate              # apply anything outstanding
npm run db:migrate -- --status  # show what has run, and what has not
```

They also run automatically when the app opens the database, so in development
you rarely need to think about it.

## Why this exists

While the database is disposable, changing the schema means deleting the file
and starting over. Once real games are stored, that stops being an option —
deleting is throwing away people's games. From then on the schema has to be
*evolved* in place, and doing that reliably means knowing exactly which changes
a given database has already seen.

Setting this up while the database is still disposable costs an hour. Adding it
afterwards, to a live database with real data, is genuinely unpleasant.

## Writing one

Create the next number:

```
migrations/0002_add_passwords.sql
```

```sql
-- 0002_add_passwords — accounts get a password.
ALTER TABLE users ADD COLUMN password_hash TEXT;
```

Then `npm run db:migrate`.

## Rules

- **Never edit a migration that has been applied anywhere real.** Write a new
  one instead. Editing an applied migration means two databases silently
  disagree about their own schema, and nothing will tell you.
- **Keep them small and forward-only.** One concern per file.
- Each runs in a transaction, so a failure leaves nothing half-applied.
- SQLite's `ALTER TABLE` is limited — it can add a column but not drop or alter
  one. Removing a column means creating a new table, copying the rows, and
  swapping. Postgres is more capable, so a migration that works on SQLite will
  generally work there.

## Moving to Postgres

`0001_initial.sql` is written in the SQLite subset that mostly ports. The known
differences are listed at the top of that file — `strftime`, the `GLOB` board
check, and epoch integers. When the time comes, the initial migration is
translated once and later migrations are written against Postgres.
