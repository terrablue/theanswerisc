FROM node:alpine AS builder

WORKDIR /theanswerisc

COPY . .

RUN npm install; \
  npm run build;

FROM ghcr.io/ammnt/freenginx:latest

COPY --from=builder /theanswerisc/site /usr/share/nginx/html
COPY ./nginx.conf /etc/freenginx/conf.d/default.conf
