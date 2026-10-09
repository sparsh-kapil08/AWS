import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import farmerRoutes from './routes/farmerRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import voiceRoutes from './routes/voiceRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve Static Frontend Apps
app.use('/farmer', express.static(path.join(rootDir, 'public', 'farmer')));
app.use('/admin', express.static(path.join(rootDir, 'public', 'admin')));

// Mount API Routes
app.use('/api', farmerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/voice', voiceRoutes);

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    service: 'khetvaani-api'
  });
});

// Root Redirect to Farmer PWA
app.get('/', (req, res) => {
  res.redirect('/farmer/index.html');
});

export { app };

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`🌾 KhetVaani Agronomy Platform running at http://localhost:${PORT}`);
    console.log(`📱 Farmer PWA: http://localhost:${PORT}/farmer/index.html`);
    console.log(`📡 Admin Console: http://localhost:${PORT}/admin/index.html`);
  });
}
