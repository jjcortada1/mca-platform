# Security & HTTPS Setup

## What's been secured

- **Session secret** — auto-generated cryptographically random 64-byte secret, saved to `.session_secret`  
- **Cookies** — HttpOnly (JS can't read), SameSite=Strict (CSRF protection), Secure flag in production  
- **Session fixation** — session ID regenerated on every login  
- **Brute-force protection** — max 10 login attempts per IP per 15 minutes  
- **Security headers** — X-Frame-Options, X-Content-Type-Options, X-XSS-Protection, Referrer-Policy  
- **Server fingerprinting removed** — X-Powered-By header stripped  
- **HTTPS redirect** — HTTP automatically redirects to HTTPS when SSL certs are present  

---

## Option 1: Self-signed cert (local / internal use)

Run this once in your project folder:
```
npm run gen-cert
```
This creates `ssl/cert.pem` and `ssl/key.pem`. Restart the server — it will automatically switch to HTTPS on port 443.

> Browsers will show a warning for self-signed certs. Click "Advanced → Proceed" to continue.

---

## Option 2: Real SSL cert (public domain — recommended)

If your server has a domain name, use **Certbot** (free via Let's Encrypt):

```bash
# Install certbot
sudo apt install certbot

# Get cert (replace yourdomain.com)
sudo certbot certonly --standalone -d yourdomain.com

# Copy certs to your project
mkdir -p ssl
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem ssl/cert.pem
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem ssl/key.pem
sudo chmod 644 ssl/*.pem
```

Restart the server. Certs auto-renew every 90 days.

---

## Option 3: Reverse proxy (nginx — most common for production)

Let nginx handle SSL and proxy to your Node app on port 3000:

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}
```

Run in production mode:
```
NODE_ENV=production npm start
```

---

## Environment variables (optional)

| Variable | Default | Description |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `HTTPS_PORT` | 443 | HTTPS port (when using SSL certs) |
| `NODE_ENV` | — | Set to `production` to enable secure cookies & HTTPS redirect |
