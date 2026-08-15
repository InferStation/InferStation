from fastapi import APIRouter

from apps.api.app.api.v1 import datasets, endpoints, runs

api_router = APIRouter()
api_router.include_router(endpoints.router)
api_router.include_router(datasets.router)
api_router.include_router(runs.router)
