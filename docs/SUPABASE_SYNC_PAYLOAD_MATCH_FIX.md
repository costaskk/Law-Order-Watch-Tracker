# Supabase sync payload/matching fix

This patch fixes two issues:

1. `payload is not defined` in the frontend sync flow by using a scoped `syncPayload` variable.
2. Supabase sync returning zero usable matches by matching Trakt watched data against `law_order_tracker_app/data/episodes.js` on the server and returning statuses keyed by both the guide `id` and the normalized `Show|Season|Episode` key.

It also keeps the Trakt `User-Agent` header on all token/API calls to reduce Cloudflare blocks.
