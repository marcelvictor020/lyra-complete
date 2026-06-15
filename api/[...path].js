import { handleLyraRequest } from '../server.js';

export const config = {
  runtime: 'nodejs'
};

export default async function handler(req, res) {
  return handleLyraRequest(req, res, { serveStaticAssets: false });
}