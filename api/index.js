// Vercel entry point: no listener, local database, timers or separate backend URL.
import { CloudStore, postgresDriver } from '../src/server/cloud/store.js'
import { createCloudApp } from '../src/server/cloud/app.js'

export function createHandler(getApp) {
  let app
  return function handler(req, res) {
    try {
      app ||= getApp()
      const url = new URL(req.url, 'http://internal')
      const route = url.searchParams.get('__path')
      if (route !== null) {
        url.searchParams.delete('__path')
        req.url = '/api/' + route + (url.search ? url.search : '')
      }
      return app(req, res)
    } catch {
      res.statusCode = 503
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify({ error: 'DATABASE_NOT_CONFIGURED', message: 'Connect Neon Postgres in Vercel Storage, set DATABASE_URL, then redeploy.' }))
    }
  }
}
export default createHandler(() => createCloudApp(new CloudStore(postgresDriver(process.env.DATABASE_URL || process.env.POSTGRES_URL))))
