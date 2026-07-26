CREATE DATABASE IF NOT EXISTS tankono;
USE tankono;

CREATE TABLE IF NOT EXISTS stations (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug       VARCHAR(64)  NOT NULL UNIQUE,
  name       VARCHAR(128) NOT NULL,
  source     ENUM('tank_ono','mbenzin') NOT NULL,
  is_primary TINYINT(1)   NOT NULL DEFAULT 0,
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
  FOREIGN KEY (station_id) REFERENCES stations(id)
);

CREATE TABLE IF NOT EXISTS subscribers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  subscribed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
