// Package handlers contains the Echo HTTP handlers.
package handlers

import (
	"net/http"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"go-api/internal/models"
)

type Handler struct {
	DB *gorm.DB
}

// Health reports whether the API is up and the database is reachable.
func (h *Handler) Health(c echo.Context) error {
	sqlDB, err := h.DB.DB()
	if err == nil {
		err = sqlDB.PingContext(c.Request().Context())
	}
	if err != nil {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"status": "unhealthy", "database": "down"})
	}
	return c.JSON(http.StatusOK, map[string]string{"status": "ok!!", "database": "up"})
}

// ListItems returns all items.
func (h *Handler) ListItems(c echo.Context) error {
	var items []models.Item
	if err := h.DB.WithContext(c.Request().Context()).Find(&items).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusOK, items)
}

// CreateItem creates an item from a JSON body.
func (h *Handler) CreateItem(c echo.Context) error {
	var item models.Item
	if err := c.Bind(&item); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	if item.Name == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "name is required")
	}
	if err := h.DB.WithContext(c.Request().Context()).Create(&item).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, item)
}
