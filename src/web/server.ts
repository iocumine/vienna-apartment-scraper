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

// Build the Express dashboard app. Kept thin; logic lives in ./data (unit-tested).
export function createServer(repo: Repository, config: AppConfig): Express {
  const app = express();

  app.get('/', (_req, res) => {
    res.send(renderOverview(buildSummary(repo, config)));
  });

  app.get('/listings', (_req, res) => {
    res.send(renderListings(buildActiveListings(repo)));
  });

  app.get('/new-listings', (_req, res) => {
    res.send(renderNewListings(buildNewListings(repo)));
  });

  app.get('/trends', (_req, res) => {
    res.send(renderTrends(buildTrends(repo)));
  });

  app.get('/map', (_req, res) => {
    res.send(renderMap(buildMapData(repo)));
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
