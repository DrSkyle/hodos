# Appwrite TablesDB, with client-side hazard merging

Data lives in Appwrite TablesDB: an `events` table any client may append to and
none may read, and a `hazards` table any client may read. Creating the tables,
columns, permissions and indexes is scripted in `appwrite/setup.sh`.

Aggregation is currently done by the client at the end of a trip: it clusters
its own impacts and merges them into the nearest existing hazard row. This
needs no server key and works today, but it is gameable and can lose counts
under concurrency.

_Consequences:_ the intended upgrade is server-side aggregation over the
`events` log, which the schema already supports. Until then, the map is
best-effort and the trade-off is documented in the README.

_Considered:_ an Appwrite Function with a schedule, and a GitHub Action with a
server API key. Both need a project API key, which the CLI cannot mint and which
must be created in the Appwrite console.
