// Package config loads application settings from environment variables.
package config

import (
	"fmt"
	"net/url"
	"os"
)

type Config struct {
	Port string
	DB   DB
}

type DB struct {
	Host     string
	Port     string
	User     string
	Password string
	Name     string
	SSLMode  string
}

// Load reads configuration from the environment. Defaults match the
// alpine-postgres VM in ../postgresql; only DB_PASSWORD is required.
func Load() (Config, error) {
	cfg := Config{
		Port: getenv("PORT", "8080"),
		DB: DB{
			Host:     getenv("DB_HOST", "192.168.1.30"),
			Port:     getenv("DB_PORT", "5432"),
			User:     getenv("DB_USER", "app"),
			Password: os.Getenv("DB_PASSWORD"),
			Name:     getenv("DB_NAME", "app"),
			SSLMode:  getenv("DB_SSLMODE", "disable"),
		},
	}

	if cfg.DB.Password == "" {
		return Config{}, fmt.Errorf("DB_PASSWORD is not set (see .env.example)")
	}
	return cfg, nil
}

// DSN returns a postgres:// connection string with the credentials escaped.
func (d DB) DSN() string {
	u := url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(d.User, d.Password),
		Host:     d.Host + ":" + d.Port,
		Path:     d.Name,
		RawQuery: "sslmode=" + d.SSLMode,
	}
	return u.String()
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
