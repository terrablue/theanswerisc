FROM node:19-alpine as builder

ENV BRANCH_NAME=master

RUN apk add --no-cache --update \
  curl;
   
RUN curl https://codeload.github.com/terrablue/theanswerisc/tar.gz/${BRANCH_NAME} | tar -xz; \
  mv theanswerisc-${BRANCH_NAME} theanswerisc;

WORKDIR /theanswerisc

RUN npm install; \
  npm run build;
COPY ./favicon.ico /theanswerisc/site
COPY ./robots.txt /theanswerisc/site

FROM nginx:mainline-alpine

COPY --from=builder /theanswerisc/site /usr/share/nginx/html
COPY ./nginx.conf /etc/nginx/conf.d/default.conf

