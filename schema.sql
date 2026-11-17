CREATE DATABASE IF NOT EXISTS tankono;
USE tankono;

CREATE TABLE IF NOT EXISTS stations (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug       VARCHAR(64)  NOT NULL UNIQUE,
  name       VARCHAR(128) NOT NULL,
  location   VARCHAR(128) NULL,
  source     VARCHAR(32)  NOT NULL,
  is_primary TINYINT(1)   NOT NULL DEFAULT 0,
  is_active  TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order INT          NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS price_checks (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  station_id INT UNSIGNED NOT NULL,
  checked_at DATETIME NOT NULL,
  natural95  DECIMAL(5,2) NOT NULL,
  diesel     DECIMAL(5,2) NOT NULL,
  changed    TINYINT(1) NOT NULL DEFAULT 0,
  INDEX idx_station_time (station_id, checked_at),
  CONSTRAINT fk_price_checks_station FOREIGN KEY (station_id) REFERENCES stations(id)
);

CREATE TABLE IF NOT EXISTS subscribers (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  token         CHAR(32) NULL,
  subscribed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  stations      VARCHAR(64) NOT NULL DEFAULT 'tank-ono,makro',
  fuels         VARCHAR(64) NOT NULL DEFAULT 'natural95,diesel',
  UNIQUE INDEX uq_subscribers_token (token)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  endpoint   VARCHAR(500) NOT NULL UNIQUE,
  p256dh     VARCHAR(255) NOT NULL,
  auth       VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  stations   VARCHAR(64) NOT NULL DEFAULT 'tank-ono,makro',
  fuels      VARCHAR(64) NOT NULL DEFAULT 'natural95,diesel'
);
