// Package database opens the GORM connection and runs migrations.
package database

import (
	"fmt"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"go-api/internal/config"
	"go-api/internal/models"
)

// Connect opens a connection to Postgres and auto-migrates the models.
func Connect(cfg config.DB) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(cfg.DSN()), &gorm.Config{})
	if err != nil {
		return nil, fmt.Errorf("connect to postgres: %w", err)
	}

	// Register every model here so AutoMigrate keeps the schema in sync.
	if err := db.AutoMigrate(&models.Item{}); err != nil {
		return nil, fmt.Errorf("auto-migrate: %w", err)
	}
	return db, nil
}
