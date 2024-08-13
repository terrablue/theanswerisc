FROM node:alpine AS builder

WORKDIR /theanswerisc

COPY . .

RUN npm install; \
  npm run build;

FROM nginx:mainline-alpine

COPY --from=builder /theanswerisc/site /usr/share/nginx/html
COPY ./nginx.conf /etc/nginx/conf.d/default.conf
