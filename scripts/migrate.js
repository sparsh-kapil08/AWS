/**
 * KhetVaani - Database Migration Script
 * Runs at deploy time against AWS RDS PostgreSQL with PostGIS
 */
import pg from 'pg';
import { SEED_CROP_STAGE_RULES, SEED_AUDIO_CLIPS } from '../src/db/seedData.js';

const { Pool } = pg;

export async function runMigration(connectionString) {
  const dbUrl = connectionString || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.log('[Migration] No DATABASE_URL specified. Running with in-memory store.');
    return;
  }

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  console.log('[Migration] Connected to PostgreSQL. Running migrations...');

  try {
    await client.query('BEGIN');

    // 1. Enable PostGIS extension
    console.log('[Migration] Enabling PostGIS extension...');
    await client.query('CREATE EXTENSION IF NOT EXISTS postgis;');

    // 2. Create Farmers table
    await client.query(`
      CREATE TABLE IF NOT EXISTS farmers (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(128) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        lang VARCHAR(10) DEFAULT 'hi',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 3. Create Plots table with PostGIS geometry
    await client.query(`
      CREATE TABLE IF NOT EXISTS plots (
        id VARCHAR(64) PRIMARY KEY,
        farmer_id VARCHAR(64) REFERENCES farmers(id) ON DELETE CASCADE,
        crop VARCHAR(64) NOT NULL,
        sowing_date DATE NOT NULL,
        stage_override VARCHAR(64),
        is_demo BOOLEAN DEFAULT FALSE,
        lat DOUBLE PRECISION NOT NULL,
        lon DOUBLE PRECISION NOT NULL,
        location GEOMETRY(Point, 4326),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_plots_location ON plots USING GIST(location);
    `);

    // 4. Create Events table
    await client.query(`
      CREATE TABLE IF NOT EXISTS events (
        id VARCHAR(64) PRIMARY KEY,
        type VARCHAR(64) NOT NULL,
        severity VARCHAR(32) NOT NULL,
        radius_km DOUBLE PRECISION NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lon DOUBLE PRECISION NOT NULL,
        location GEOMETRY(Point, 4326),
        headline_hi TEXT,
        headline_en TEXT,
        simulated BOOLEAN DEFAULT FALSE,
        status VARCHAR(32) DEFAULT 'active',
        created_by VARCHAR(64) DEFAULT 'admin',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_events_location ON events USING GIST(location);
    `);

    // 5. Create Alerts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id VARCHAR(64) PRIMARY KEY,
        plot_id VARCHAR(64) REFERENCES plots(id) ON DELETE CASCADE,
        event_id VARCHAR(64) REFERENCES events(id) ON DELETE SET NULL,
        level VARCHAR(32) NOT NULL,
        status VARCHAR(32) DEFAULT 'created',
        clip_sequence JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_alerts_plot_status ON alerts(plot_id, status);
    `);

    // 6. Create Alert Acknowledgements & Timeline table
    await client.query(`
      CREATE TABLE IF NOT EXISTS acknowledgements (
        id VARCHAR(64) PRIMARY KEY,
        alert_id VARCHAR(64) REFERENCES alerts(id) ON DELETE CASCADE,
        response VARCHAR(64) NOT NULL,
        at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS alert_events (
        id VARCHAR(64) PRIMARY KEY,
        alert_id VARCHAR(64) REFERENCES alerts(id) ON DELETE CASCADE,
        state VARCHAR(32) NOT NULL,
        channel VARCHAR(64) DEFAULT 'pwa_touch_ack',
        at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 7. Create Crop Stage Rules table & seed defaults
    await client.query(`
      CREATE TABLE IF NOT EXISTS crop_stage_rules (
        id VARCHAR(64) PRIMARY KEY,
        crop VARCHAR(64) NOT NULL,
        stage VARCHAR(64) NOT NULL,
        condition_type VARCHAR(64) NOT NULL,
        threshold DOUBLE PRECISION NOT NULL,
        action_key VARCHAR(128) NOT NULL,
        severity VARCHAR(32) NOT NULL,
        description_hi TEXT,
        description_en TEXT
      );
    `);

    for (const rule of SEED_CROP_STAGE_RULES) {
      await client.query(`
        INSERT INTO crop_stage_rules (id, crop, stage, condition_type, threshold, action_key, severity, description_hi, description_en)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          threshold = EXCLUDED.threshold,
          action_key = EXCLUDED.action_key,
          severity = EXCLUDED.severity;
      `, [rule.id, rule.crop, rule.stage, rule.conditionType, rule.threshold, rule.actionKey, rule.severity, rule.description_hi, rule.description_en]);
    }

    // 8. Create Audio Clips metadata table
    await client.query(`
      CREATE TABLE IF NOT EXISTS audio_clips (
        clip_key VARCHAR(128) PRIMARY KEY,
        text_hi TEXT NOT NULL,
        text_en TEXT,
        s3_key VARCHAR(255),
        duration_sec DOUBLE PRECISION,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    for (const clip of SEED_AUDIO_CLIPS) {
      await client.query(`
        INSERT INTO audio_clips (clip_key, text_hi, text_en)
        VALUES ($1, $2, $3)
        ON CONFLICT (clip_key) DO NOTHING;
      `, [clip.clip_key, clip.text_hi, clip.text_en]);
    }

    // 9. Admin Audit Logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id VARCHAR(64) PRIMARY KEY,
        action VARCHAR(64) NOT NULL,
        details JSONB,
        performed_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query('COMMIT');
    console.log('[Migration] Database migration completed successfully with PostGIS and seed rules!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] Migration failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Allow direct CLI invocation: node scripts/migrate.js
if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  runMigration().catch(() => process.exit(1));
}
