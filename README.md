# Tank ONO Watcher

Scrapes Tank ONO fuel prices every 5 minutes. Emails all subscribers when prices change. Web dashboard on subdomain.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in values
3. Run SQL from `schema.sql` to create the database tables
4. `npm start`

## VPS deployment (pm2)

    npm install -g pm2
    pm2 start ecosystem.config.js
    pm2 save
    pm2 startup

## Nginx config

    server {
        server_name tankono.bagros.eu;
        location / {
            proxy_pass http://localhost:3000;
            proxy_set_header Host $host;
        }
    }
