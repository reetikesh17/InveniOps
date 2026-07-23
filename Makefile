-include .env

POSTGRES_USER ?= ims_user
POSTGRES_DB ?= ims

COMPOSE := docker compose

.PHONY: up down logs reset db-shell

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f

reset:
	$(COMPOSE) down -v

db-shell:
	$(COMPOSE) exec postgres psql -U $(POSTGRES_USER) -d $(POSTGRES_DB)
