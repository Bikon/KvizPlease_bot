INSERT INTO games (external_id, title, date_time, venue, district, address, price, difficulty, status, url, group_key, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
ON CONFLICT (external_id)
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
  updated_at = now();
