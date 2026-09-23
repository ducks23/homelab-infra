// Package models holds the GORM models.
package models

import "gorm.io/gorm"

// Item is a placeholder model to show the pattern; replace it with your own.
type Item struct {
	gorm.Model
	Name        string `json:"name" gorm:"not null"`
	Description string `json:"description"`
}
