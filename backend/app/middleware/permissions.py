from fastapi import Depends, HTTPException, status

from app.models.user import User
from app.permissions import ROLE_PERMISSIONS


def require_permission(permission: str):
    def dependency(current_user: User = Depends(get_current_user)):
        user_permissions = ROLE_PERMISSIONS.get(current_user.role, [])
        if permission not in user_permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission '{permission}' required",
            )
        return current_user
    return dependency


from app.dependencies import get_current_user
