# V2 firmware placeholder

The production V2 firmware was not present in this Git checkout, its remote-tracking `main` tree, or the existing stash during the repository restructuring. No substitute firmware has been created.

Restore the authoritative ESP32-S3 / LILYGO T-SIM7080-S3 + HLK-LD2451 source here before making firmware changes. Preserve its uploads to `traffic_passages`, `ten_minute_summaries`, `sensor_health`, and optional `reference_measurements`.

Future raw UART archival must use either short-lived presigned R2 PUT URLs or an authenticated Cloudflare Worker with an R2 binding. Never embed permanent R2 credentials in firmware.
