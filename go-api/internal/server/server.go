// Package server builds the Echo instance and registers routes.
package server

import (
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"gorm.io/gorm"

	"go-api/internal/handlers"
)

func New(db *gorm.DB) *echo.Echo {
	e := echo.New()
	e.HideBanner = true

	e.Use(middleware.Logger())
	e.Use(middleware.Recover())

	h := &handlers.Handler{DB: db}

	e.GET("/health", h.Health)

	api := e.Group("/api/v1")
	api.GET("/items", h.ListItems)
	api.POST("/items", h.CreateItem)

	return e
}
