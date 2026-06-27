import express, { type Express } from 'express';
import {
  buildSummary,
  buildTrends,
  buildMapData,
  buildActiveListings,
  buildNewListings,
} from './data.js';
import {
  renderOverview,
  renderTrends,
  renderMap,
  renderListings,
  renderNewListings,
} from './views.js';
import type { Repository } from '../db/index.js';
import type { AppConfig } from '../types.js';
import { getUiAlerts } from '../lib/willhabenStatus.js';

function parseDistrictQuery(raw: unknown): number | null {
  const n = Number(typeof raw === 'string' ? raw : '');
  return Number.isFinite(n) ? n : null;
}

// Build the Express dashboard app. Kept thin; logic lives in ./data (unit-tested).
export function createServer(repo: Repository, config: AppConfig): Express {
  const app = express();
  const alerts = () => getUiAlerts();

  app.get('/', (_req, res) => {
    res.send(renderOverview(buildSummary(repo, config)));
  });

  app.get('/listings', (req, res) => {
    const district = parseDistrictQuery(req.query.district);
    res.send(renderListings(buildActiveListings(repo), district, alerts()));
  });

  app.get('/new-listings', (req, res) => {
    const district = parseDistrictQuery(req.query.district);
    res.send(renderNewListings(buildNewListings(repo), district, alerts()));
  });

  app.get('/trends', (_req, res) => {
    res.send(renderTrends(buildTrends(repo), alerts()));
  });

  app.get('/map', (_req, res) => {
    res.send(renderMap(buildMapData(repo), alerts()));
  });

  app.get('/api/summary', (_req, res) => {
    res.json(buildSummary(repo, config));
  });

  app.get('/api/trends', (_req, res) => {
    res.json(buildTrends(repo));
  });

  app.get('/api/listings/map', (_req, res) => {
    res.json(buildMapData(repo));
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', active: repo.countActive() });
  });

  return app;
}
