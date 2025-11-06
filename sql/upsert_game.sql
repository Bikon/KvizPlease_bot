INSERT INTO games (chat_id, external_id, title, date_time, venue, district, address, price, difficulty, status, url, group_key, source_url, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
    ON CONFLICT (chat_id, external_id)
DO UPDATE SET
    title = EXCLUDED.title,
           date_time = EXCLUDED.date_time,
           venue = EXCLUDED.venue,
           district = EXCLUDED.district,
           address = EXCLUDED.address,
           price = EXCLUDED.price,
           difficulty = EXCLUDED.difficulty,
           status = EXCLUDED.status,
           url = EXCLUDED.url,
           group_key = EXCLUDED.group_key,
           source_url = EXCLUDED.source_url,
           updated_at = now();
