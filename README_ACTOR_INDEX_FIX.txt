Wolf Universe actor filter fix

This fixes the "No actor data" dropdown by building a separate actor index from TMDB aggregate credits.
Actors are ordered by total credited episode appearances across all tracker shows, and anyone with fewer than 10 appearances is ignored by default.

Install:
1) Copy these files into your project:
   - app.js -> law_order_tracker_app/app.js
   - index.html -> law_order_tracker_app/index.html
   - wolf_build_actor_index.py -> project root

2) Make sure .env.local contains:
   TMDB_API_KEY=your_real_tmdb_key

3) Build regular actor index:
   python wolf_build_actor_index.py --min-episodes 10

4) Optional, slower but more precise episode matching:
   python wolf_build_actor_index.py --min-episodes 10 --episode-credits

5) Restart local server:
   python local_tracker_server.py --host 0.0.0.0 --port 8080

Notes:
- The dropdown should show actors like "Actor Name (123)" ordered by most appearances.
- Without --episode-credits, actor filtering uses show-level credited appearances. With --episode-credits, it can match exact episodes when TMDB provides episode credits.
